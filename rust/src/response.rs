/// The result of a delivered incident.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncidentResponse {
    successful: bool,
    code: i32,
    message: Option<String>,
    incident_id: Option<String>,
}

impl IncidentResponse {
    pub(crate) const fn new(
        successful: bool,
        code: i32,
        message: Option<String>,
        incident_id: Option<String>,
    ) -> Self {
        Self {
            successful,
            code,
            message,
            incident_id,
        }
    }

    /// Returns the API's own success flag, defaulting to whether the HTTP status
    /// was 2xx when the body does not carry one.
    #[must_use]
    pub const fn is_successful(&self) -> bool {
        self.successful
    }

    /// Returns the API's own code, defaulting to the HTTP status.
    #[must_use]
    pub const fn code(&self) -> i32 {
        self.code
    }

    /// Returns the API's human-readable message, when it sent one.
    #[must_use]
    pub fn message(&self) -> Option<&str> {
        self.message.as_deref()
    }

    /// Returns the created incident's identifier, when the API returned one.
    #[must_use]
    pub fn incident_id(&self) -> Option<&str> {
        self.incident_id.as_deref()
    }
}
