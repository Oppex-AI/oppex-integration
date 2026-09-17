use std::time::Duration;

use crate::error::{IncidentError, NO_STATUS_CODE};
use crate::internal::interrupt::Interrupt;

/// The fixed backoff schedule: five retries after the first attempt, doubling,
/// without jitter. It is deliberately not configurable.
pub(crate) const DEFAULT_RETRY_DELAYS: [Duration; 5] = [
    Duration::from_millis(500),
    Duration::from_millis(1000),
    Duration::from_millis(2000),
    Duration::from_millis(4000),
    Duration::from_millis(8000),
];

/// An explicit list rather than "any 5xx". Widening it is a deliberate policy
/// change, not an incidental one.
pub(crate) fn is_retryable_status(status: i32) -> bool {
    matches!(status, 429 | 500 | 502 | 503 | 504)
}

/// Runs `operation` until it succeeds, fails with a non-retryable error, or
/// exhausts `delays`.
///
/// Only the final failure is returned. Individual attempts are never logged, so
/// a saturated Oppex API cannot flood the host's logs.
pub(crate) fn execute_with_retry<T, F>(
    delays: &[Duration],
    interrupt: &Interrupt,
    mut operation: F,
) -> Result<T, IncidentError>
where
    F: FnMut() -> Result<T, IncidentError>,
{
    let mut attempt = 0;
    loop {
        match operation() {
            Ok(value) => return Ok(value),
            Err(failure) => {
                if !failure.is_retryable() || attempt >= delays.len() {
                    return Err(with_attempt_count(failure, attempt + 1));
                }
                if interrupt.wait(delays[attempt]) {
                    return Err(IncidentError::delivery(
                        "incident delivery was interrupted during retry",
                        NO_STATUS_CODE,
                        false,
                    ));
                }
                attempt += 1;
            }
        }
    }
}

/// Annotates only a failure that never reached a status line. An HTTP failure
/// keeps the message its status already explains.
fn with_attempt_count(failure: IncidentError, attempts: usize) -> IncidentError {
    match failure {
        IncidentError::Delivery {
            message,
            status_code,
            retryable,
            source,
        } if status_code == NO_STATUS_CODE && attempts > 1 => IncidentError::Delivery {
            message: format!("{message} (after {attempts} attempts)"),
            status_code,
            retryable,
            source,
        },
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::time::Duration;

    use super::{DEFAULT_RETRY_DELAYS, execute_with_retry, is_retryable_status};
    use crate::error::{IncidentError, NO_STATUS_CODE};
    use crate::internal::interrupt::Interrupt;

    const FAST: [Duration; 5] = [Duration::from_millis(1); 5];

    #[test]
    fn the_retryable_status_list_is_explicit() {
        for status in [429, 500, 502, 503, 504] {
            assert!(is_retryable_status(status), "{status} must be retryable");
        }
        for status in [400, 401, 403, 404, 409, 422, 501, 505] {
            assert!(!is_retryable_status(status), "{status} must not be retryable");
        }
    }

    #[test]
    fn the_schedule_doubles_from_half_a_second() {
        assert_eq!(
            [
                Duration::from_millis(500),
                Duration::from_millis(1000),
                Duration::from_millis(2000),
                Duration::from_millis(4000),
                Duration::from_millis(8000),
            ],
            DEFAULT_RETRY_DELAYS
        );
    }

    #[test]
    fn stops_at_the_first_success() {
        let attempts = Cell::new(0);
        let result = execute_with_retry(&FAST, &Interrupt::new(), || {
            attempts.set(attempts.get() + 1);
            if attempts.get() < 3 {
                Err(IncidentError::delivery("503", 503, true))
            } else {
                Ok("delivered")
            }
        });

        assert_eq!("delivered", result.unwrap());
        assert_eq!(3, attempts.get());
    }

    #[test]
    fn does_not_retry_a_non_retryable_failure() {
        let attempts = Cell::new(0);
        let result: Result<(), _> = execute_with_retry(&FAST, &Interrupt::new(), || {
            attempts.set(attempts.get() + 1);
            Err(IncidentError::delivery("401", 401, false))
        });

        assert!(result.is_err());
        assert_eq!(1, attempts.get());
    }

    #[test]
    fn exhausts_the_schedule_without_rewriting_an_http_failure() {
        let attempts = Cell::new(0);
        let failure = execute_with_retry(&FAST, &Interrupt::new(), || {
            attempts.set(attempts.get() + 1);
            Err::<(), _>(IncidentError::delivery("Oppex returned HTTP 503", 503, true))
        })
        .unwrap_err();

        assert_eq!(FAST.len() + 1, attempts.get());
        assert_eq!("Oppex returned HTTP 503", failure.to_string());
    }

    #[test]
    fn annotates_only_a_failure_that_never_reached_a_status_line() {
        let failure = execute_with_retry(&FAST, &Interrupt::new(), || {
            Err::<(), _>(IncidentError::delivery(
                "connection refused",
                NO_STATUS_CODE,
                true,
            ))
        })
        .unwrap_err();

        assert_eq!("connection refused (after 6 attempts)", failure.to_string());
    }

    #[test]
    fn a_signalled_interrupt_ends_the_backoff_immediately() {
        let interrupt = Interrupt::new();
        interrupt.signal();

        let failure = execute_with_retry(&DEFAULT_RETRY_DELAYS, &interrupt, || {
            Err::<(), _>(IncidentError::delivery("503", 503, true))
        })
        .unwrap_err();

        assert!(failure.to_string().contains("interrupted"), "{failure}");
    }
}
