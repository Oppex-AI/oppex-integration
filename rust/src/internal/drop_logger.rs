use std::sync::Mutex;
use std::time::{Duration, Instant};

pub(crate) const DROP_LOG_INTERVAL: Duration = Duration::from_secs(60);

/// Counts every dropped incident but emits at most one summary per interval.
///
/// A saturated queue drops continuously, so logging each drop would replace one
/// overload with another.
#[derive(Debug)]
pub(crate) struct RateLimitedDropLogger {
    interval: Duration,
    state: Mutex<DropState>,
}

#[derive(Debug)]
struct DropState {
    dropped: u64,
    started_at: Instant,
}

impl RateLimitedDropLogger {
    pub(crate) fn new(interval: Duration) -> Self {
        Self {
            interval,
            state: Mutex::new(DropState {
                dropped: 0,
                started_at: Instant::now(),
            }),
        }
    }

    /// Records one drop, returning the accumulated count when the interval has
    /// elapsed and the caller should emit a summary.
    ///
    /// Returning the count instead of logging directly keeps this type free of
    /// any logging decision, which is also what makes it testable without
    /// capturing output.
    pub(crate) fn record_drop(&self) -> Option<u64> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.dropped += 1;
        if state.started_at.elapsed() < self.interval {
            return None;
        }
        let dropped = state.dropped;
        state.dropped = 0;
        state.started_at = Instant::now();
        Some(dropped)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::RateLimitedDropLogger;

    #[test]
    fn holds_drops_back_until_the_interval_elapses() {
        let logger = RateLimitedDropLogger::new(Duration::from_secs(60));

        for _ in 0..10 {
            assert_eq!(
                None,
                logger.record_drop(),
                "no summary is due inside the interval"
            );
        }
    }

    #[test]
    fn reports_the_accumulated_count_once_the_interval_elapses() {
        let logger = RateLimitedDropLogger::new(Duration::ZERO);

        assert_eq!(Some(1), logger.record_drop());
        // The counter resets, so the next interval starts from zero rather than
        // re-reporting everything seen so far.
        assert_eq!(Some(1), logger.record_drop());
    }
}
