use std::error::Error;
use std::fmt;

/// The status code reported when a delivery failed before any HTTP status line
/// was received.
pub const NO_STATUS_CODE: i32 = -1;

/// Every failure this SDK reports.
#[derive(Debug)]
pub enum IncidentError {
    /// The configuration or the incident failed validation. The call never
    /// reached the network.
    InvalidRequest {
        /// What was wrong with the input.
        message: String,
    },
    /// The client was closed before this call.
    ClientClosed,
    /// Delivery was attempted and failed.
    Delivery {
        /// What went wrong.
        message: String,
        /// The HTTP status, or [`NO_STATUS_CODE`] when no response arrived.
        status_code: i32,
        /// Whether the failure was eligible for retry.
        retryable: bool,
        /// The underlying transport or decoding failure, when there was one.
        source: Option<Box<dyn Error + Send + Sync>>,
    },
}

impl IncidentError {
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::InvalidRequest {
            message: message.into(),
        }
    }

    pub(crate) fn delivery(message: impl Into<String>, status_code: i32, retryable: bool) -> Self {
        Self::Delivery {
            message: message.into(),
            status_code,
            retryable,
            source: None,
        }
    }

    pub(crate) fn delivery_caused_by(
        message: impl Into<String>,
        status_code: i32,
        retryable: bool,
        source: impl Error + Send + Sync + 'static,
    ) -> Self {
        Self::Delivery {
            message: message.into(),
            status_code,
            retryable,
            source: Some(Box::new(source)),
        }
    }

    /// Returns the HTTP status when the failure carried one.
    #[must_use]
    pub fn status_code(&self) -> Option<i32> {
        match self {
            Self::Delivery { status_code, .. } if *status_code != NO_STATUS_CODE => Some(*status_code),
            _ => None,
        }
    }

    /// Returns whether the failure was eligible for retry.
    #[must_use]
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Delivery { retryable: true, .. })
    }
}

impl fmt::Display for IncidentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest { message } => write!(formatter, "invalid request: {message}"),
            Self::ClientClosed => formatter.write_str("the incident client is closed"),
            Self::Delivery { message, .. } => formatter.write_str(message),
        }
    }
}

impl Error for IncidentError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Delivery {
                source: Some(cause), ..
            } => Some(cause.as_ref()),
            _ => None,
        }
    }
}
