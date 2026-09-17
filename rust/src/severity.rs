use std::fmt;

/// Oppex incident severity, on a scale from 1 (lowest) to 5 (highest).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Severity {
    /// Wire value 1.
    Lowest,
    /// Wire value 2.
    Low,
    /// Wire value 3.
    Medium,
    /// Wire value 4.
    High,
    /// Wire value 5.
    Critical,
}

impl Severity {
    /// Returns the numeric value sent to Oppex.
    #[must_use]
    pub const fn value(self) -> u8 {
        match self {
            Self::Lowest => 1,
            Self::Low => 2,
            Self::Medium => 3,
            Self::High => 4,
            Self::Critical => 5,
        }
    }

    /// Returns the severity for an Oppex numeric value.
    ///
    /// # Errors
    ///
    /// Returns [`IncidentError::InvalidRequest`] when `value` is outside 1 to 5.
    ///
    /// [`IncidentError::InvalidRequest`]: crate::IncidentError::InvalidRequest
    pub fn from_value(value: u8) -> Result<Self, crate::IncidentError> {
        match value {
            1 => Ok(Self::Lowest),
            2 => Ok(Self::Low),
            3 => Ok(Self::Medium),
            4 => Ok(Self::High),
            5 => Ok(Self::Critical),
            _ => Err(crate::IncidentError::invalid("severity must be between 1 and 5")),
        }
    }
}

impl fmt::Display for Severity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::Lowest => "LOWEST",
            Self::Low => "LOW",
            Self::Medium => "MEDIUM",
            Self::High => "HIGH",
            Self::Critical => "CRITICAL",
        };
        formatter.write_str(name)
    }
}

#[cfg(test)]
mod tests {
    use super::Severity;

    #[test]
    fn wire_values_match_the_oppex_scale() {
        assert_eq!(1, Severity::Lowest.value());
        assert_eq!(2, Severity::Low.value());
        assert_eq!(3, Severity::Medium.value());
        assert_eq!(4, Severity::High.value());
        assert_eq!(5, Severity::Critical.value());
    }

    #[test]
    fn from_value_round_trips_every_severity() {
        for severity in [
            Severity::Lowest,
            Severity::Low,
            Severity::Medium,
            Severity::High,
            Severity::Critical,
        ] {
            assert_eq!(severity, Severity::from_value(severity.value()).unwrap());
        }
    }

    #[test]
    fn from_value_rejects_values_outside_the_scale() {
        for value in [0, 6, 255] {
            assert!(Severity::from_value(value).is_err(), "{value} must be rejected");
        }
    }

    #[test]
    fn display_uses_the_documented_names() {
        assert_eq!("MEDIUM", Severity::Medium.to_string());
    }
}
