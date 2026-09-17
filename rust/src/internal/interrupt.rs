use std::sync::{Condvar, Mutex};
use std::time::Duration;

/// A one-way "stop waiting" signal.
///
/// A sleeping thread cannot be interrupted in Rust the way a Java thread can, so
/// a backoff delay waits on this condition variable instead of calling
/// [`std::thread::sleep`]. Closing the client signals it once, which wakes every
/// waiting retry immediately rather than after up to eight more seconds.
#[derive(Debug)]
pub(crate) struct Interrupt {
    signalled: Mutex<bool>,
    changed: Condvar,
}

impl Interrupt {
    pub(crate) fn new() -> Self {
        Self {
            signalled: Mutex::new(false),
            changed: Condvar::new(),
        }
    }

    /// Signals every current and future waiter. Idempotent.
    pub(crate) fn signal(&self) {
        // A poisoned lock means another thread panicked while holding it. The
        // flag itself is still consistent, so recover rather than propagate a
        // panic out of a shutdown path.
        let mut signalled = self
            .signalled
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *signalled = true;
        self.changed.notify_all();
    }

    /// Waits up to `duration`. Returns `true` when the wait was cut short by a
    /// signal, `false` when the full duration elapsed.
    pub(crate) fn wait(&self, duration: Duration) -> bool {
        let signalled = self
            .signalled
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (signalled, _) = self
            .changed
            .wait_timeout_while(signalled, duration, |signalled| !*signalled)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *signalled
    }
}
