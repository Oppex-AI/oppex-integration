use std::env;
use std::time::Duration;

use ureq::Agent;

use crate::error::{IncidentError, NO_STATUS_CODE};
use crate::internal::retry::is_retryable_status;
use crate::internal::wire::parse_response;
use crate::response::IncidentResponse;

/// The Oppex incident endpoint every client posts to.
pub const DEFAULT_ENDPOINT: &str = "https://api.oppex.ai/api/v1/incident/post";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const SOCKET_TIMEOUT: Duration = Duration::from_secs(5);
/// Bounds a whole attempt so a server that trickles bytes forever cannot hold a
/// delivery open past the sum of its phase timeouts.
const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_CONNECTIONS: usize = 20;
/// The API returns a small envelope. Anything larger is a misbehaving proxy, and
/// reading it in full would let that proxy dictate this client's memory use.
const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;

/// Resolves the target URL.
///
/// The override exists so tests can point the whole delivery path at a loopback
/// server. It is deliberately not client configuration, which would add a public
/// knob that exists only to ease testing.
fn endpoint() -> String {
    env::var("OPPEX_TEST_ENDPOINT_URL")
        .ok()
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| DEFAULT_ENDPOINT.to_owned())
}

/// The HTTP adapter. It owns the connection pool, so closing a client releases
/// the sockets that client opened and no others.
#[derive(Debug)]
pub(crate) struct Transport {
    api_key: String,
    endpoint: String,
    agent: Agent,
}

impl Transport {
    pub(crate) fn new(api_key: String) -> Self {
        Self::with_endpoint(api_key, endpoint())
    }

    /// Builds a transport aimed at an explicit URL. In-crate tests use this to
    /// point the whole delivery path at a loopback server without touching
    /// process-wide environment state.
    pub(crate) fn with_endpoint(api_key: String, endpoint: String) -> Self {
        let config = Agent::config_builder()
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_recv_response(Some(SOCKET_TIMEOUT))
            .timeout_global(Some(ATTEMPT_TIMEOUT))
            .max_idle_connections(MAX_CONNECTIONS)
            .max_idle_connections_per_host(MAX_CONNECTIONS)
            // Non-2xx statuses are this SDK's own retry decision, not an error
            // the HTTP layer should raise before the status is even inspected.
            .http_status_as_error(false)
            .build();
        Self {
            api_key,
            endpoint,
            agent: Agent::new_with_config(config),
        }
    }

    /// Performs one attempt. Every failure carries its own retry decision, so the
    /// retry loop never has to inspect a transport-specific error type.
    pub(crate) fn send(&self, payload: &str) -> Result<IncidentResponse, IncidentError> {
        let mut response = self
            .agent
            .post(&self.endpoint)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("X-API-KEY", &self.api_key)
            .send(payload)
            .map_err(|cause| {
                // No status line was received, so the failure is transport-level
                // and retryable regardless of what the underlying error was.
                IncidentError::delivery_caused_by(
                    "incident delivery failed before a response was received",
                    NO_STATUS_CODE,
                    true,
                    cause,
                )
            })?;

        let status = i32::from(response.status().as_u16());
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_RESPONSE_BYTES)
            .read_to_string()
            .map_err(|cause| {
                IncidentError::delivery_caused_by(
                    "reading the Oppex response body",
                    NO_STATUS_CODE,
                    true,
                    cause,
                )
            })?;

        if (200..300).contains(&status) {
            return parse_response(status, &body);
        }
        Err(status_failure(status, &body))
    }
}

/// Turns a non-2xx response into a delivery failure, adding the API's own
/// message when the body carries one.
fn status_failure(status: i32, body: &str) -> IncidentError {
    let mut message = format!("Oppex returned HTTP {status}");
    if let Ok(parsed) = parse_response(status, body)
        && let Some(detail) = parsed.message()
        && !detail.trim().is_empty()
    {
        message = format!("{message}: {detail}");
    }
    IncidentError::delivery(message, status, is_retryable_status(status))
}
