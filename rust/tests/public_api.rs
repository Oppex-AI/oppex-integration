//! Exercises the crate exactly as a consumer does: through its public API only,
//! with no access to in-crate test seams. If a type, method or error variant a
//! caller needs stops being exported, this file stops compiling.
//!
//! Network-free: every case here fails validation before any HTTP attempt.

use oppex_sdk::{DEFAULT_ENDPOINT, IncidentClient, IncidentError, IncidentRequest, Severity};

fn client() -> IncidentClient {
    IncidentClient::builder()
        .api_key("external-consumer-api-key")
        .service_key("external-consumer-service-key")
        .build()
        .expect("building the client")
}

#[test]
fn the_endpoint_is_the_agreed_one() {
    assert_eq!("https://api.oppex.ai/api/v1/incident/post", DEFAULT_ENDPOINT);
}

#[test]
fn severity_maps_to_the_oppex_scale() {
    assert_eq!(3, Severity::Medium.value());
    assert_eq!(Severity::Critical, Severity::from_value(5).unwrap());
}

#[test]
fn a_valid_request_builds() {
    let request = IncidentRequest::builder()
        .title("External consumer test")
        .source("cargo-test")
        .severity(Severity::Medium)
        .build()
        .expect("building the request");

    assert_eq!(Severity::Medium, request.severity());
    assert_eq!(1, request.priority());
}

#[test]
fn an_invalid_request_is_rejected_at_the_call_site() {
    let failure = IncidentRequest::builder()
        .source("cargo-test")
        .severity(Severity::Medium)
        .build()
        .unwrap_err();

    assert!(matches!(failure, IncidentError::InvalidRequest { .. }));
}

#[test]
fn a_blank_api_key_is_rejected() {
    let failure = IncidentClient::builder().api_key("  ").build().unwrap_err();
    assert!(matches!(failure, IncidentError::InvalidRequest { .. }));
}

#[test]
fn service_routing_refuses_a_request_service_key() {
    // The precondition fails before any network call, so this stays network-free.
    let request = IncidentRequest::builder()
        .title("Service routing test")
        .source("cargo-test")
        .severity(Severity::Low)
        .service_key("external-consumer-service-key")
        .build()
        .expect("building the request");

    let failure = client().post_with_service_routing(&request).unwrap_err();
    assert!(matches!(failure, IncidentError::InvalidRequest { .. }));
}

#[test]
fn a_closed_client_refuses_every_post() {
    let request = IncidentRequest::builder()
        .title("Closed client test")
        .source("cargo-test")
        .severity(Severity::Low)
        .build()
        .expect("building the request");

    let client = client();
    client.close();

    assert!(matches!(client.post(&request), Err(IncidentError::ClientClosed)));
    assert!(matches!(
        client.post_async(request),
        Err(IncidentError::ClientClosed)
    ));
}
