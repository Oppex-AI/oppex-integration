use serde_json::Value;

use crate::error::IncidentError;
use crate::request::IncidentRequest;
use crate::response::IncidentResponse;

/// Renders the wire payload.
///
/// The payload is built field by field rather than through a serializable struct
/// so the field order is the agreed wire order and an absent optional field is
/// omitted entirely rather than sent as null. String values are escaped by
/// `serde_json`, so the hand-built object is still correctly encoded JSON.
pub(crate) fn serialize_request(request: &IncidentRequest, resolved_service_key: Option<&str>) -> String {
    let mut payload = String::with_capacity(512);
    payload.push('{');

    let mut first = true;
    push_optional_string(&mut payload, &mut first, "serviceKey", resolved_service_key);
    push_string(&mut payload, &mut first, "title", request.title());
    push_string(&mut payload, &mut first, "source", request.source());
    push_number(
        &mut payload,
        &mut first,
        "severity",
        i64::from(request.severity().value()),
    );
    push_number(
        &mut payload,
        &mut first,
        "priority",
        i64::from(request.priority()),
    );
    push_number(&mut payload, &mut first, "srcTimestamp", request.src_timestamp());
    push_optional_string(&mut payload, &mut first, "component", request.component());
    push_optional_string(&mut payload, &mut first, "group", request.group());
    push_optional_string(&mut payload, &mut first, "type", request.incident_type());
    push_optional_string(&mut payload, &mut first, "detailsJSON", request.details());

    payload.push('}');
    payload
}

fn push_separator(payload: &mut String, first: &mut bool) {
    if *first {
        *first = false;
    } else {
        payload.push(',');
    }
}

fn push_string(payload: &mut String, first: &mut bool, name: &str, value: &str) {
    push_separator(payload, first);
    payload.push_str(&Value::from(name).to_string());
    payload.push(':');
    payload.push_str(&Value::from(value).to_string());
}

fn push_optional_string(payload: &mut String, first: &mut bool, name: &str, value: Option<&str>) {
    if let Some(value) = value {
        push_string(payload, first, name, value);
    }
}

fn push_number(payload: &mut String, first: &mut bool, name: &str, value: i64) {
    push_separator(payload, first);
    payload.push_str(&Value::from(name).to_string());
    payload.push(':');
    payload.push_str(&value.to_string());
}

/// Decodes a response body, falling back to the HTTP status for any field the
/// body does not carry.
///
/// A body that is not JSON is never echoed into the returned error: a proxy or
/// WAF can return an error page that repeats request headers, including
/// `X-API-KEY`, and that text would then leak into the host's logs.
pub(crate) fn parse_response(http_status: i32, body: &str) -> Result<IncidentResponse, IncidentError> {
    let successful = (200..300).contains(&http_status);
    if body.trim().is_empty() {
        return Ok(IncidentResponse::new(successful, http_status, None, None));
    }

    let parsed: Value = serde_json::from_str(body).map_err(|cause| {
        IncidentError::delivery_caused_by(
            format!("Oppex returned a non-JSON response (status {http_status})"),
            http_status,
            false,
            cause,
        )
    })?;
    let Some(object) = parsed.as_object() else {
        return Err(IncidentError::delivery(
            format!("Oppex returned a non-object JSON response (status {http_status})"),
            http_status,
            false,
        ));
    };

    Ok(IncidentResponse::new(
        object
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(successful),
        object
            .get("code")
            .and_then(Value::as_i64)
            .and_then(|code| i32::try_from(code).ok())
            .unwrap_or(http_status),
        object.get("message").and_then(Value::as_str).map(str::to_owned),
        object.get("data").and_then(Value::as_str).map(str::to_owned),
    ))
}

#[cfg(test)]
mod tests {
    use super::{parse_response, serialize_request};
    use crate::error::IncidentError;
    use crate::request::IncidentRequest;
    use crate::severity::Severity;

    fn request() -> IncidentRequest {
        IncidentRequest::builder()
            .title("title")
            .source("source")
            .severity(Severity::High)
            .priority(2)
            .src_timestamp(1_700_000_000_000)
            .build()
            .unwrap()
    }

    #[test]
    fn serialize_omits_absent_optional_fields() {
        let payload = serialize_request(&request(), None);
        assert_eq!(
            r#"{"title":"title","source":"source","severity":4,"priority":2,"srcTimestamp":1700000000000}"#,
            payload
        );
    }

    #[test]
    fn serialize_uses_the_agreed_field_names_and_order() {
        let request = IncidentRequest::builder()
            .title("title")
            .source("source")
            .severity(Severity::Low)
            .src_timestamp(1)
            .component("api")
            .group("payments")
            .incident_type("latency")
            .details(r#"{"p99":1200}"#)
            .build()
            .unwrap();

        let payload = serialize_request(&request, Some("resolved-service-key"));
        assert_eq!(
            concat!(
                r#"{"serviceKey":"resolved-service-key","title":"title","source":"source","severity":2,"#,
                r#""priority":1,"srcTimestamp":1,"component":"api","group":"payments","type":"latency","#,
                r#""detailsJSON":"{\"p99\":1200}"}"#
            ),
            payload
        );
    }

    #[test]
    fn serialize_escapes_values() {
        let request = IncidentRequest::builder()
            .title("a \"quoted\" \n title")
            .source("source")
            .severity(Severity::Low)
            .src_timestamp(1)
            .build()
            .unwrap();

        let payload = serialize_request(&request, None);
        assert!(
            payload.contains(r#""title":"a \"quoted\" \n title""#),
            "{payload}"
        );
        let reparsed: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!("a \"quoted\" \n title", reparsed["title"].as_str().unwrap());
    }

    #[test]
    fn parse_reads_the_envelope() {
        let response = parse_response(
            200,
            r#"{"success":true,"code":201,"message":"created","data":"INC-1"}"#,
        )
        .unwrap();
        assert!(response.is_successful());
        assert_eq!(201, response.code());
        assert_eq!(Some("created"), response.message());
        assert_eq!(Some("INC-1"), response.incident_id());
    }

    #[test]
    fn parse_falls_back_to_the_http_status() {
        let response = parse_response(202, "   ").unwrap();
        assert!(response.is_successful());
        assert_eq!(202, response.code());
        assert_eq!(None, response.incident_id());
    }

    #[test]
    fn parse_never_echoes_a_non_json_body() {
        let failure = parse_response(502, "<html>X-API-KEY: super-secret</html>").unwrap_err();
        assert!(matches!(failure, IncidentError::Delivery { .. }));
        assert!(!failure.to_string().contains("super-secret"), "{failure}");
    }
}
