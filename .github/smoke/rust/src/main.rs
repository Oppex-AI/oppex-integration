//! Exercises the published Rust SDK surface from outside its own crate,
//! mirroring `.github/smoke/java/ExternalConsumer.java`: only supported API,
//! network-free, and a fixed sentinel the workflow greps for.
//!
//! "Network-free" does not mean "never attempts an HTTP call". Port 1 on
//! loopback refuses the connection immediately, so a fully valid request pointed
//! at it still reaches the real transport and fails there, genuinely exercising
//! that path without touching the actual Oppex service.

use std::process::ExitCode;

use oppex_sdk::{DEFAULT_ENDPOINT, IncidentClient, IncidentError, IncidentRequest, Severity, VERSION};

fn main() -> ExitCode {
    match run() {
        Ok(()) => {
            println!("EXTERNAL_CONSUMER_OK rust sdk={VERSION}");
            ExitCode::SUCCESS
        }
        Err(failure) => {
            eprintln!("{failure}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    if DEFAULT_ENDPOINT != "https://api.oppex.ai/api/v1/incident/post" {
        return Err(format!("unexpected endpoint {DEFAULT_ENDPOINT}"));
    }
    if Severity::Medium.value() != 3 {
        return Err("unexpected severity mapping".to_owned());
    }

    check_real_transport_failure()?;
    check_validation()?;
    check_service_routing()
}

/// Reaches the actual transport and requires it to fail with a connection
/// refusal, not a validation error.
fn check_real_transport_failure() -> Result<(), String> {
    // Safety: this is single-threaded start-up code, before any thread that
    // could read the environment concurrently has been created.
    unsafe { std::env::set_var("OPPEX_TEST_ENDPOINT_URL", "http://127.0.0.1:1") };

    let client = IncidentClient::builder()
        .api_key("wrong-api-key")
        .service_key("wrong-service-key")
        .build()
        .map_err(|failure| format!("building the client: {failure}"))?;

    let request = IncidentRequest::builder()
        .title("valid title")
        .source("github-actions")
        .severity(Severity::Medium)
        .build()
        .map_err(|failure| format!("building the request: {failure}"))?;

    let failure = client
        .post(&request)
        .expect_err("a refused connection must fail");
    if !matches!(failure, IncidentError::Delivery { .. }) {
        return Err(format!("a refused connection must be a Delivery error: {failure:?}"));
    }
    if failure.status_code().is_some() {
        return Err("a refused connection must carry no HTTP status".to_owned());
    }
    // Five retries plus the first attempt, so the message carries the count.
    if !failure.to_string().contains("attempts") {
        return Err(format!("an exhausted network failure must report its attempts: {failure}"));
    }

    unsafe { std::env::remove_var("OPPEX_TEST_ENDPOINT_URL") };
    Ok(())
}

fn check_validation() -> Result<(), String> {
    // A blank title fails before any HTTP attempt.
    let failure = IncidentRequest::builder()
        .title("")
        .source("github-actions")
        .severity(Severity::Medium)
        .build()
        .expect_err("a blank title must be rejected");
    if !matches!(failure, IncidentError::InvalidRequest { .. }) {
        return Err(format!("a blank title must be an InvalidRequest: {failure:?}"));
    }

    let client = IncidentClient::builder()
        .api_key("external-consumer-api-key")
        .service_key("external-consumer-service-key")
        .build()
        .map_err(|failure| format!("building the client: {failure}"))?;
    let request = IncidentRequest::builder()
        .title("Closed client test")
        .source("github-actions")
        .severity(Severity::Low)
        .build()
        .map_err(|failure| format!("building the request: {failure}"))?;

    client.close();
    match client.post(&request) {
        Err(IncidentError::ClientClosed) => Ok(()),
        other => Err(format!("a post after close must report a closed client: {other:?}")),
    }
}

/// Exercises the precondition, which fails before any network call.
fn check_service_routing() -> Result<(), String> {
    let client = IncidentClient::builder()
        .api_key("external-consumer-api-key")
        .build()
        .map_err(|failure| format!("building the client: {failure}"))?;

    let keyed = IncidentRequest::builder()
        .title("Service routing test")
        .source("github-actions")
        .severity(Severity::Low)
        .service_key("external-consumer-service-key")
        .build()
        .map_err(|failure| format!("building the request: {failure}"))?;

    match client.post_with_service_routing(&keyed) {
        Err(IncidentError::InvalidRequest { .. }) => Ok(()),
        other => Err(format!("service routing must refuse a request service key: {other:?}")),
    }
}
