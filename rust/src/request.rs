use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::IncidentError;
use crate::severity::Severity;

/// The maximum length of `source`, counted in Unicode characters.
const MAX_SOURCE_LENGTH: usize = 255;

/// A validated, immutable incident submission.
///
/// Build one with [`IncidentRequest::builder`]. A request may override the
/// service key configured on the client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncidentRequest {
    service_key: Option<String>,
    title: String,
    source: String,
    severity: Severity,
    priority: u8,
    src_timestamp: i64,
    component: Option<String>,
    group: Option<String>,
    incident_type: Option<String>,
    details: Option<String>,
}

impl IncidentRequest {
    /// Starts building a request.
    #[must_use]
    pub fn builder() -> IncidentRequestBuilder {
        IncidentRequestBuilder::default()
    }

    pub(crate) fn service_key(&self) -> Option<&str> {
        self.service_key.as_deref()
    }

    /// Returns the incident headline.
    #[must_use]
    pub fn title(&self) -> &str {
        &self.title
    }

    /// Returns the emitting system.
    #[must_use]
    pub fn source(&self) -> &str {
        &self.source
    }

    /// Returns the severity.
    #[must_use]
    pub const fn severity(&self) -> Severity {
        self.severity
    }

    /// Returns the priority, 1 through 5.
    #[must_use]
    pub const fn priority(&self) -> u8 {
        self.priority
    }

    /// Returns the source timestamp, in milliseconds since the Unix epoch.
    #[must_use]
    pub const fn src_timestamp(&self) -> i64 {
        self.src_timestamp
    }

    /// Returns the component, when one was set.
    #[must_use]
    pub fn component(&self) -> Option<&str> {
        self.component.as_deref()
    }

    /// Returns the group, when one was set.
    #[must_use]
    pub fn group(&self) -> Option<&str> {
        self.group.as_deref()
    }

    /// Returns the incident type, when one was set.
    #[must_use]
    pub fn incident_type(&self) -> Option<&str> {
        self.incident_type.as_deref()
    }

    /// Returns the JSON text sent in the wire-level `detailsJSON` field.
    #[must_use]
    pub fn details(&self) -> Option<&str> {
        self.details.as_deref()
    }
}

/// Builds a validated [`IncidentRequest`].
///
/// Validation happens in [`IncidentRequestBuilder::build`], so a malformed
/// incident is rejected at the call site rather than inside a worker thread.
#[derive(Debug, Default, Clone)]
pub struct IncidentRequestBuilder {
    service_key: Option<String>,
    title: Option<String>,
    source: Option<String>,
    severity: Option<Severity>,
    priority: Option<u8>,
    src_timestamp: Option<i64>,
    component: Option<String>,
    group: Option<String>,
    incident_type: Option<String>,
    details: Option<String>,
}

impl IncidentRequestBuilder {
    /// Sets the incident headline. Required.
    #[must_use]
    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// Sets the emitting system. Required, at most 255 characters.
    #[must_use]
    pub fn source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }

    /// Sets the severity. Required.
    #[must_use]
    pub const fn severity(mut self, severity: Severity) -> Self {
        self.severity = Some(severity);
        self
    }

    /// Sets the priority, 1 through 5. Defaults to 1.
    #[must_use]
    pub const fn priority(mut self, priority: u8) -> Self {
        self.priority = Some(priority);
        self
    }

    /// Sets the source timestamp in milliseconds since the Unix epoch. Defaults
    /// to the current time.
    #[must_use]
    pub const fn src_timestamp(mut self, src_timestamp: i64) -> Self {
        self.src_timestamp = Some(src_timestamp);
        self
    }

    /// Overrides the service key configured on the client.
    #[must_use]
    pub fn service_key(mut self, service_key: impl Into<String>) -> Self {
        self.service_key = Some(service_key.into());
        self
    }

    /// Sets the component.
    #[must_use]
    pub fn component(mut self, component: impl Into<String>) -> Self {
        self.component = Some(component.into());
        self
    }

    /// Sets the group.
    #[must_use]
    pub fn group(mut self, group: impl Into<String>) -> Self {
        self.group = Some(group.into());
        self
    }

    /// Sets the incident type. Named `incident_type` because `type` is a Rust
    /// keyword; it is still sent as `type` on the wire.
    #[must_use]
    pub fn incident_type(mut self, incident_type: impl Into<String>) -> Self {
        self.incident_type = Some(incident_type.into());
        self
    }

    /// Sets JSON text to send in the `detailsJSON` field.
    #[must_use]
    pub fn details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    /// Validates the input and returns an immutable request.
    ///
    /// # Errors
    ///
    /// Returns [`IncidentError::InvalidRequest`] when a required field is
    /// missing or blank, `source` exceeds 255 characters, an optional field is
    /// present but blank, `priority` is outside 1 to 5, or `src_timestamp` is
    /// not positive.
    pub fn build(self) -> Result<IncidentRequest, IncidentError> {
        let title = require_non_blank(self.title, "title")?;
        let source = require_non_blank(self.source, "source")?;
        if source.chars().count() > MAX_SOURCE_LENGTH {
            return Err(IncidentError::invalid(format!(
                "source must not exceed {MAX_SOURCE_LENGTH} characters"
            )));
        }

        let severity = self
            .severity
            .ok_or_else(|| IncidentError::invalid("severity must be set"))?;

        let priority = self.priority.unwrap_or(1);
        if !(1..=5).contains(&priority) {
            return Err(IncidentError::invalid("priority must be between 1 and 5"));
        }

        let src_timestamp = match self.src_timestamp {
            Some(timestamp) => timestamp,
            None => now_millis(),
        };
        if src_timestamp <= 0 {
            return Err(IncidentError::invalid("srcTimestamp must be greater than zero"));
        }

        Ok(IncidentRequest {
            service_key: reject_blank(self.service_key, "serviceKey")?,
            title,
            source,
            severity,
            priority,
            src_timestamp,
            component: reject_blank(self.component, "component")?,
            group: reject_blank(self.group, "group")?,
            incident_type: reject_blank(self.incident_type, "type")?,
            details: reject_blank(self.details, "details")?,
        })
    }
}

fn require_non_blank(value: Option<String>, field: &str) -> Result<String, IncidentError> {
    match value {
        Some(value) if !value.trim().is_empty() => Ok(value),
        Some(_) => Err(IncidentError::invalid(format!("{field} must not be blank"))),
        None => Err(IncidentError::invalid(format!("{field} must be set"))),
    }
}

/// An optional field may be absent, but a present-yet-blank value is nearly
/// always a bug at the call site, so it is rejected rather than silently sent.
fn reject_blank(value: Option<String>, field: &str) -> Result<Option<String>, IncidentError> {
    match value {
        Some(value) if value.trim().is_empty() => Err(IncidentError::invalid(format!(
            "{field} must not be blank when supplied"
        ))),
        other => Ok(other),
    }
}

/// Returns the current time in milliseconds since the Unix epoch. A clock set
/// before 1970 yields 0, which `build` then rejects rather than silently
/// sending a nonsensical timestamp.
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{IncidentRequest, MAX_SOURCE_LENGTH};
    use crate::error::IncidentError;
    use crate::severity::Severity;

    fn valid() -> super::IncidentRequestBuilder {
        IncidentRequest::builder()
            .title("title")
            .source("source")
            .severity(Severity::Medium)
    }

    #[test]
    fn build_applies_the_documented_defaults() {
        let request = valid().build().unwrap();
        assert_eq!(1, request.priority());
        assert!(request.src_timestamp() > 0);
        assert!(request.component().is_none());
    }

    #[test]
    fn build_keeps_explicit_values() {
        let request = valid()
            .priority(4)
            .src_timestamp(1_700_000_000_000)
            .service_key("request-service-key")
            .component("api")
            .group("payments")
            .incident_type("latency")
            .details("{\"p99\":1200}")
            .build()
            .unwrap();

        assert_eq!(4, request.priority());
        assert_eq!(1_700_000_000_000, request.src_timestamp());
        assert_eq!(Some("request-service-key"), request.service_key());
        assert_eq!(Some("latency"), request.incident_type());
    }

    #[track_caller]
    fn assert_invalid(result: &Result<IncidentRequest, IncidentError>) {
        assert!(
            matches!(result, Err(IncidentError::InvalidRequest { .. })),
            "expected an InvalidRequest, got {result:?}"
        );
    }

    #[test]
    fn build_rejects_missing_or_blank_required_fields() {
        assert_invalid(
            &IncidentRequest::builder()
                .source("source")
                .severity(Severity::Low)
                .build(),
        );
        assert_invalid(
            &IncidentRequest::builder()
                .title("title")
                .severity(Severity::Low)
                .build(),
        );
        assert_invalid(&IncidentRequest::builder().title("title").source("source").build());
        assert_invalid(&valid().title("   ").build());
        assert_invalid(&valid().source("\t").build());
    }

    #[test]
    fn build_enforces_the_source_length_cap() {
        assert!(valid().source("a".repeat(MAX_SOURCE_LENGTH)).build().is_ok());
        assert_invalid(&valid().source("a".repeat(MAX_SOURCE_LENGTH + 1)).build());
    }

    #[test]
    fn build_rejects_a_blank_optional_field() {
        assert_invalid(&valid().component("  ").build());
        assert_invalid(&valid().group("").build());
        assert_invalid(&valid().service_key(" ").build());
    }

    #[test]
    fn build_rejects_out_of_range_numbers() {
        assert_invalid(&valid().priority(0).build());
        assert_invalid(&valid().priority(6).build());
        assert_invalid(&valid().src_timestamp(0).build());
        assert_invalid(&valid().src_timestamp(-1).build());
    }
}
