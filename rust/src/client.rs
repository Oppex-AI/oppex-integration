use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::error::IncidentError;
use crate::internal::dispatcher::{AsyncDispatcher, CLOSE_DRAIN_TIMEOUT, QUEUE_CAPACITY, WORKER_COUNT};
use crate::internal::interrupt::Interrupt;
use crate::internal::retry::{DEFAULT_RETRY_DELAYS, execute_with_retry};
use crate::internal::transport::Transport;
use crate::internal::wire::serialize_request;
use crate::request::IncidentRequest;
use crate::response::IncidentResponse;

/// Posts incidents to Oppex.
///
/// The client is `Send + Sync`; create one per application, share it across
/// threads, and close it during shutdown. Dropping it closes it.
#[derive(Debug)]
pub struct IncidentClient {
    inner: Arc<Inner>,
    dispatcher: AsyncDispatcher,
    closed: AtomicBool,
}

/// The state a queued delivery needs. Held behind an `Arc` so a task that
/// outlives `close` still has a live transport rather than a dangling borrow.
#[derive(Debug)]
struct Inner {
    service_key: Option<String>,
    transport: Transport,
    interrupt: Interrupt,
    retry_delays: Vec<Duration>,
}

impl IncidentClient {
    /// Starts building a client.
    #[must_use]
    pub fn builder() -> IncidentClientBuilder {
        IncidentClientBuilder::default()
    }

    /// Posts on the calling thread, including any retry delays. The request's
    /// own service key overrides the client's.
    ///
    /// # Errors
    ///
    /// Returns [`IncidentError::ClientClosed`] after [`close`](Self::close),
    /// [`IncidentError::InvalidRequest`] when neither the client nor the request
    /// carries a service key, and [`IncidentError::Delivery`] when delivery
    /// fails.
    pub fn post(&self, request: &IncidentRequest) -> Result<IncidentResponse, IncidentError> {
        self.ensure_open()?;
        self.require_service_key(request)?;
        self.inner.deliver(request, self.inner.service_key.as_deref())
    }

    /// Posts without a service key so Oppex resolves the target service itself.
    /// The request must not carry its own service key. Otherwise identical to
    /// [`post`](Self::post).
    ///
    /// # Errors
    ///
    /// As [`post`](Self::post), and [`IncidentError::InvalidRequest`] when the
    /// request carries its own service key.
    pub fn post_with_service_routing(
        &self,
        request: &IncidentRequest,
    ) -> Result<IncidentResponse, IncidentError> {
        self.ensure_open()?;
        require_service_routable(request)?;
        self.inner.deliver(request, None)
    }

    /// Queues a best-effort delivery and returns immediately.
    ///
    /// The closed-client and service-key checks still run on the calling thread,
    /// so a misuse is reported to the caller rather than lost in a worker. A
    /// delivery failure after queueing is logged at debug level.
    ///
    /// # Errors
    ///
    /// Returns [`IncidentError::ClientClosed`] after [`close`](Self::close), and
    /// [`IncidentError::InvalidRequest`] when no service key is available.
    pub fn post_async(&self, request: IncidentRequest) -> Result<(), IncidentError> {
        self.ensure_open()?;
        self.require_service_key(&request)?;
        let service_key = self.inner.service_key.clone();
        self.submit(request, service_key)
    }

    /// Queues a best-effort service-routed delivery. The request must not carry
    /// its own service key.
    ///
    /// # Errors
    ///
    /// As [`post_async`](Self::post_async), and [`IncidentError::InvalidRequest`]
    /// when the request carries its own service key.
    pub fn post_async_with_service_routing(&self, request: IncidentRequest) -> Result<(), IncidentError> {
        self.ensure_open()?;
        require_service_routable(&request)?;
        self.submit(request, None)
    }

    /// Drains queued work for up to ten seconds, then releases every owned
    /// resource. Idempotent, and called automatically when the client drops.
    pub fn close(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        // Signalled before the drain so a worker sitting in an eight-second
        // backoff gives up now instead of consuming the whole drain budget.
        self.inner.interrupt.signal();
        self.dispatcher.close(CLOSE_DRAIN_TIMEOUT);
    }

    fn ensure_open(&self) -> Result<(), IncidentError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(IncidentError::ClientClosed);
        }
        Ok(())
    }

    /// Service routing is the only delivery mode available when no service key is
    /// configured anywhere.
    fn require_service_key(&self, request: &IncidentRequest) -> Result<(), IncidentError> {
        if self.inner.service_key.is_none() && request.service_key().is_none() {
            return Err(IncidentError::invalid(
                "no serviceKey is configured on the client or the request; \
                 supply one or use post_with_service_routing",
            ));
        }
        Ok(())
    }

    fn submit(&self, request: IncidentRequest, service_key: Option<String>) -> Result<(), IncidentError> {
        let inner = Arc::clone(&self.inner);
        let accepted = self.dispatcher.submit(Box::new(move || {
            if let Err(failure) = inner.deliver(&request, service_key.as_deref()) {
                log::debug!("oppex: asynchronous incident delivery failed: {failure}");
            }
        }));
        if accepted {
            Ok(())
        } else {
            Err(IncidentError::ClientClosed)
        }
    }
}

impl Inner {
    /// Serializes, sends and retries a single incident. The request's own service
    /// key wins over `default_service_key`.
    fn deliver(
        &self,
        request: &IncidentRequest,
        default_service_key: Option<&str>,
    ) -> Result<IncidentResponse, IncidentError> {
        let service_key = request.service_key().or(default_service_key);
        let payload = serialize_request(request, service_key);
        execute_with_retry(&self.retry_delays, &self.interrupt, || {
            self.transport.send(&payload)
        })
    }
}

impl Drop for IncidentClient {
    fn drop(&mut self) {
        self.close();
    }
}

fn require_service_routable(request: &IncidentRequest) -> Result<(), IncidentError> {
    if request.service_key().is_some() {
        return Err(IncidentError::invalid(
            "request must not carry a serviceKey when service routing is used",
        ));
    }
    Ok(())
}

/// Builds a reusable [`IncidentClient`].
#[derive(Debug, Default, Clone)]
pub struct IncidentClientBuilder {
    api_key: Option<String>,
    service_key: Option<String>,
    /// In-crate test seam. There is deliberately no public way to set these:
    /// the endpoint and the retry schedule are part of the shared incident
    /// contract, not per-caller configuration.
    endpoint: Option<String>,
    retry_delays: Option<Vec<Duration>>,
}

impl IncidentClientBuilder {
    /// Sets the API key sent in the `X-API-KEY` header. Required.
    #[must_use]
    pub fn api_key(mut self, api_key: impl Into<String>) -> Self {
        self.api_key = Some(api_key.into());
        self
    }

    /// Sets the default service key. Optional; when omitted, incidents must
    /// either carry their own or be posted with
    /// [`IncidentClient::post_with_service_routing`].
    #[must_use]
    pub fn service_key(mut self, service_key: impl Into<String>) -> Self {
        self.service_key = Some(service_key.into());
        self
    }

    #[cfg(test)]
    pub(crate) fn endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = Some(endpoint.into());
        self
    }

    #[cfg(test)]
    pub(crate) fn retry_delays(mut self, retry_delays: Vec<Duration>) -> Self {
        self.retry_delays = Some(retry_delays);
        self
    }

    /// Validates the configuration and returns a ready client.
    ///
    /// # Errors
    ///
    /// Returns [`IncidentError::InvalidRequest`] when the API key is missing or
    /// blank.
    pub fn build(self) -> Result<IncidentClient, IncidentError> {
        let api_key = match self.api_key {
            Some(api_key) if !api_key.trim().is_empty() => api_key,
            Some(_) => return Err(IncidentError::invalid("apiKey must not be blank")),
            None => return Err(IncidentError::invalid("apiKey must be set")),
        };

        let transport = match self.endpoint {
            Some(endpoint) => Transport::with_endpoint(api_key, endpoint),
            None => Transport::new(api_key),
        };
        Ok(IncidentClient {
            inner: Arc::new(Inner {
                service_key: self.service_key.filter(|key| !key.trim().is_empty()),
                transport,
                interrupt: Interrupt::new(),
                retry_delays: self.retry_delays.unwrap_or_else(|| DEFAULT_RETRY_DELAYS.to_vec()),
            }),
            dispatcher: AsyncDispatcher::new(WORKER_COUNT, QUEUE_CAPACITY),
            closed: AtomicBool::new(false),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::Mutex;
    use std::sync::mpsc::{Receiver, channel};
    use std::thread;
    use std::time::Duration;

    use super::{IncidentClient, IncidentError};
    use crate::request::IncidentRequest;
    use crate::severity::Severity;

    const FAST_RETRIES: [Duration; 5] = [Duration::from_millis(1); 5];

    /// A loopback stand-in for the Oppex API. Tests never reach the real
    /// service; only the local listener started here.
    struct StubServer {
        url: String,
        requests: Receiver<RecordedRequest>,
    }

    struct RecordedRequest {
        headers: Vec<String>,
        body: String,
    }

    impl RecordedRequest {
        fn header(&self, name: &str) -> Option<&str> {
            let prefix = format!("{}:", name.to_lowercase());
            self.headers
                .iter()
                .find(|header| header.to_lowercase().starts_with(&prefix))
                .and_then(|header| header.split_once(':'))
                .map(|(_, value)| value.trim())
        }

        fn payload(&self) -> serde_json::Value {
            serde_json::from_str(&self.body).expect("the client must send JSON")
        }
    }

    impl StubServer {
        /// `responses` is consumed one entry per request; the last entry repeats
        /// once the list runs out, so a test only lists the attempts it cares
        /// about.
        fn start(responses: Vec<(u16, &'static str)>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("binding a loopback port");
            let url = format!("http://{}/incident", listener.local_addr().unwrap());
            let (sender, requests) = channel();
            let responses = Mutex::new(responses.into_iter().collect::<Vec<_>>());

            thread::spawn(move || {
                for (served, stream) in listener.incoming().enumerate() {
                    let Ok(stream) = stream else { return };
                    let responses = responses.lock().unwrap();
                    let (status, body) = responses[served.min(responses.len() - 1)];
                    drop(responses);

                    match Self::serve(stream, status, body) {
                        Ok(request) => {
                            if sender.send(request).is_err() {
                                return;
                            }
                        }
                        // The test ended and dropped the server; stop quietly.
                        Err(_) => return,
                    }
                }
            });

            Self { url, requests }
        }

        fn serve(stream: TcpStream, status: u16, body: &str) -> std::io::Result<RecordedRequest> {
            let mut reader = BufReader::new(stream.try_clone()?);
            let mut headers = Vec::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line)? == 0 {
                    break;
                }
                if line.trim().is_empty() {
                    break;
                }
                headers.push(line.trim_end().to_owned());
            }

            let length = headers
                .iter()
                .find(|header| header.to_lowercase().starts_with("content-length:"))
                .and_then(|header| header.split_once(':'))
                .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            let mut body_bytes = vec![0u8; length];
            reader.read_exact(&mut body_bytes)?;

            let mut stream = stream;
            // Connection: close keeps each attempt on its own socket, so a
            // retry test counts connections as attempts without pooling in the
            // way.
            write!(
                stream,
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )?;
            stream.flush()?;

            Ok(RecordedRequest {
                headers,
                body: String::from_utf8_lossy(&body_bytes).into_owned(),
            })
        }

        fn next_request(&self) -> RecordedRequest {
            self.requests
                .recv_timeout(Duration::from_secs(10))
                .expect("the client never sent a request")
        }

        fn assert_no_further_request(&self) {
            assert!(
                self.requests.recv_timeout(Duration::from_millis(250)).is_err(),
                "the client sent more requests than expected"
            );
        }
    }

    const CREATED: &str = r#"{"success":true,"code":200,"message":"created","data":"INC-42"}"#;

    fn client_for(server: &StubServer, service_key: Option<&str>) -> IncidentClient {
        let mut builder = IncidentClient::builder()
            .api_key("api-key")
            .endpoint(&server.url)
            .retry_delays(FAST_RETRIES.to_vec());
        if let Some(service_key) = service_key {
            builder = builder.service_key(service_key);
        }
        builder.build().expect("building the client")
    }

    fn request() -> IncidentRequest {
        IncidentRequest::builder()
            .title("Checkout latency")
            .source("checkout-api")
            .severity(Severity::High)
            .src_timestamp(1_700_000_000_000)
            .build()
            .unwrap()
    }

    #[test]
    fn build_rejects_a_missing_or_blank_api_key() {
        assert!(matches!(
            IncidentClient::builder().build(),
            Err(IncidentError::InvalidRequest { .. })
        ));
        assert!(matches!(
            IncidentClient::builder().api_key("   ").build(),
            Err(IncidentError::InvalidRequest { .. })
        ));
    }

    #[test]
    fn post_sends_the_agreed_payload_and_header() {
        let server = StubServer::start(vec![(200, CREATED)]);
        let client = client_for(&server, Some("client-service-key"));

        let response = client.post(&request()).expect("posting the incident");
        assert!(response.is_successful());
        assert_eq!(Some("INC-42"), response.incident_id());

        let sent = server.next_request();
        assert_eq!(Some("api-key"), sent.header("X-API-KEY"));
        assert_eq!(Some("application/json"), sent.header("Content-Type"));

        let payload = sent.payload();
        assert_eq!("client-service-key", payload["serviceKey"]);
        assert_eq!("Checkout latency", payload["title"]);
        assert_eq!(4, payload["severity"]);
        assert_eq!(1, payload["priority"]);
        assert_eq!(1_700_000_000_000_i64, payload["srcTimestamp"]);
        assert!(
            payload.get("component").is_none(),
            "an absent optional field must be omitted"
        );
    }

    #[test]
    fn a_request_service_key_overrides_the_clients() {
        let server = StubServer::start(vec![(200, CREATED)]);
        let client = client_for(&server, Some("client-service-key"));

        let request = IncidentRequest::builder()
            .title("title")
            .source("source")
            .severity(Severity::Low)
            .service_key("request-service-key")
            .build()
            .unwrap();
        client.post(&request).expect("posting the incident");

        assert_eq!(
            "request-service-key",
            server.next_request().payload()["serviceKey"]
        );
    }

    #[test]
    fn post_requires_a_service_key_somewhere() {
        let server = StubServer::start(vec![(200, CREATED)]);
        let client = client_for(&server, None);

        assert!(matches!(
            client.post(&request()),
            Err(IncidentError::InvalidRequest { .. })
        ));
        server.assert_no_further_request();
    }

    #[test]
    fn service_routing_omits_the_service_key() {
        let server = StubServer::start(vec![(200, CREATED)]);
        let client = client_for(&server, Some("client-service-key"));

        client
            .post_with_service_routing(&request())
            .expect("posting the incident");

        assert!(
            server.next_request().payload().get("serviceKey").is_none(),
            "service routing must omit serviceKey entirely"
        );
    }

    #[test]
    fn service_routing_refuses_a_request_service_key() {
        let server = StubServer::start(vec![(200, CREATED)]);
        let client = client_for(&server, None);

        let request = IncidentRequest::builder()
            .title("title")
            .source("source")
            .severity(Severity::Low)
            .service_key("request-service-key")
            .build()
            .unwrap();

        assert!(matches!(
            client.post_with_service_routing(&request),
            Err(IncidentError::InvalidRequest { .. })
        ));
        server.assert_no_further_request();
    }

    #[test]
    fn post_retries_a_retryable_status() {
        let server = StubServer::start(vec![(503, ""), (503, ""), (200, CREATED)]);
        let client = client_for(&server, Some("service-key"));

        let response = client.post(&request()).expect("posting the incident");
        assert!(response.is_successful());

        for _ in 0..3 {
            server.next_request();
        }
        server.assert_no_further_request();
    }

    #[test]
    fn post_fails_immediately_on_a_non_retryable_status() {
        let server = StubServer::start(vec![(401, r#"{"success":false,"message":"invalid api key"}"#)]);
        let client = client_for(&server, Some("service-key"));

        let failure = client.post(&request()).unwrap_err();
        assert_eq!(Some(401), failure.status_code());
        assert!(!failure.is_retryable());
        assert!(failure.to_string().contains("invalid api key"), "{failure}");

        server.next_request();
        server.assert_no_further_request();
    }

    #[test]
    fn post_async_delivers_and_validates_on_the_calling_thread() {
        let server = StubServer::start(vec![(200, CREATED)]);
        let client = client_for(&server, None);

        assert!(
            matches!(
                client.post_async(request()),
                Err(IncidentError::InvalidRequest { .. })
            ),
            "a missing service key must be reported to the caller, not lost in a worker"
        );

        let routed = client_for(&server, Some("service-key"));
        routed.post_async(request()).expect("queueing the incident");
        assert_eq!("service-key", server.next_request().payload()["serviceKey"]);
    }

    #[test]
    fn every_post_fails_on_a_closed_client() {
        let server = StubServer::start(vec![(200, CREATED)]);
        let client = client_for(&server, Some("service-key"));
        client.close();
        client.close();

        assert!(matches!(
            client.post(&request()),
            Err(IncidentError::ClientClosed)
        ));
        assert!(matches!(
            client.post_async(request()),
            Err(IncidentError::ClientClosed)
        ));
        assert!(matches!(
            client.post_with_service_routing(&request()),
            Err(IncidentError::ClientClosed)
        ));
        server.assert_no_further_request();
    }

    #[test]
    fn the_client_is_shareable_across_threads() {
        let server = StubServer::start(vec![(200, CREATED)]);
        let client = client_for(&server, Some("service-key"));

        thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    client.post(&request()).expect("posting the incident");
                });
            }
        });

        for _ in 0..8 {
            server.next_request();
        }
    }
}
