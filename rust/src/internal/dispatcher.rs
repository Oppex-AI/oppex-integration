use std::collections::VecDeque;
use std::fmt;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::internal::drop_logger::{DROP_LOG_INTERVAL, RateLimitedDropLogger};

pub(crate) const QUEUE_CAPACITY: usize = 5000;
pub(crate) const WORKER_COUNT: usize = 2;
pub(crate) const CLOSE_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) type Task = Box<dyn FnOnce() + Send + 'static>;

/// Everything the workers and the closing thread coordinate on lives behind one
/// mutex. Keeping the lifecycle flags inside it rather than in separate atomics
/// is what makes the "check the flag, then wait" sequence race-free: a worker
/// cannot miss the wake-up that close sends between those two steps.
struct State {
    tasks: VecDeque<Task>,
    /// Whether new work is still admitted. Cleared first thing by `close`.
    accepting: bool,
    /// Whether workers should keep draining. Cleared once `close` gives up.
    draining: bool,
    /// Tasks popped from the queue but not yet finished.
    active: usize,
}

/// Delivers asynchronous incidents on a fixed number of worker threads, queueing
/// the rest up to `capacity` and dropping the oldest entry once full.
///
/// Dropping the oldest keeps the newest incident, which is the one most likely to
/// still matter, and submission never blocks the application.
///
/// `Debug` is written by hand rather than derived: a queued task is a boxed
/// closure, which cannot be `Debug`, and every public type in this crate should
/// still be printable.
pub(crate) struct AsyncDispatcher {
    shared: Arc<Shared>,
    workers: Mutex<Vec<JoinHandle<()>>>,
}

struct Shared {
    capacity: usize,
    state: Mutex<State>,
    changed: Condvar,
    drop_logger: RateLimitedDropLogger,
}

impl fmt::Debug for AsyncDispatcher {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let state = self.shared.lock();
        formatter
            .debug_struct("AsyncDispatcher")
            .field("capacity", &self.shared.capacity)
            .field("queued", &state.tasks.len())
            .field("active", &state.active)
            .field("accepting", &state.accepting)
            .finish_non_exhaustive()
    }
}

impl AsyncDispatcher {
    pub(crate) fn new(worker_count: usize, capacity: usize) -> Self {
        let shared = Arc::new(Shared {
            capacity,
            state: Mutex::new(State {
                tasks: VecDeque::new(),
                accepting: true,
                draining: true,
                active: 0,
            }),
            changed: Condvar::new(),
            drop_logger: RateLimitedDropLogger::new(DROP_LOG_INTERVAL),
        });

        let workers = (0..worker_count)
            .map(|index| {
                let shared = Arc::clone(&shared);
                thread::Builder::new()
                    .name(format!("oppex-async-{index}"))
                    .spawn(move || shared.work())
                    .expect("spawning an Oppex worker thread")
            })
            .collect();

        Self {
            shared,
            workers: Mutex::new(workers),
        }
    }

    /// Queues a task, evicting the oldest queued task when the queue is full.
    /// Reports whether the task was accepted; only a closed dispatcher refuses.
    pub(crate) fn submit(&self, task: Task) -> bool {
        let dropped = {
            let mut state = self.shared.lock();
            if !state.accepting {
                return false;
            }
            let dropped = if state.tasks.len() >= self.shared.capacity {
                state.tasks.pop_front();
                self.shared.drop_logger.record_drop()
            } else {
                None
            };
            state.tasks.push_back(task);
            dropped
        };
        self.shared.changed.notify_one();

        if let Some(dropped) = dropped {
            log::warn!("oppex: dropped {dropped} incidents in the last minute");
        }
        true
    }

    /// Stops admitting work and drains what is already queued and in flight for
    /// up to `timeout`, then abandons the rest. Idempotent, and safe to call
    /// from any thread.
    pub(crate) fn close(&self, timeout: Duration) {
        {
            let mut state = self.shared.lock();
            if !state.accepting {
                return;
            }
            state.accepting = false;
        }

        let abandoned = self.shared.drain_until(Instant::now() + timeout);
        self.shared.changed.notify_all();

        // The workers are deliberately not joined. A thread cannot be
        // interrupted in Rust, so joining one that is blocked in an HTTP attempt
        // would push `close` past its own timeout by up to the attempt timeout.
        // Java's `close()` makes the same trade: it waits for the drain, then
        // calls `shutdownNow()` and returns without waiting for whatever that
        // failed to interrupt. An idle worker exits as soon as it sees
        // `draining == false`; a busy one exits when its current attempt ends,
        // which the attempt timeout already bounds.
        drop(
            self.workers
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );

        // Reported once and directly, rather than through the rate-limited
        // overflow counter: a shutdown loss and an overload loss are different
        // events, and a rate-limited counter's last batch can go unreported.
        if abandoned > 0 {
            log::warn!("oppex: force-dropped {abandoned} pending incidents during close");
        }
    }
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        // A poisoned lock means a task panicked. The queue itself is still
        // consistent, so recovering keeps one bad task from wedging delivery
        // and shutdown for the whole process.
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn work(&self) {
        loop {
            let task = {
                let mut state = self.lock();
                loop {
                    if let Some(task) = state.tasks.pop_front() {
                        state.active += 1;
                        break Some(task);
                    }
                    if !state.draining {
                        return;
                    }
                    state = self
                        .changed
                        .wait(state)
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                }
            };

            if let Some(task) = task {
                task();
                self.lock().active -= 1;
                self.changed.notify_all();
            }
        }
    }

    /// Waits until nothing is queued or in flight, or the deadline passes. Then
    /// stops the workers and returns how many tasks were abandoned.
    fn drain_until(&self, deadline: Instant) -> usize {
        let mut state = self.lock();
        while !state.tasks.is_empty() || state.active > 0 {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                break;
            };
            let (next, _) = self
                .changed
                .wait_timeout(state, remaining)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state = next;
        }
        state.draining = false;
        let abandoned = state.tasks.len();
        state.tasks.clear();
        abandoned
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc::{channel, sync_channel};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use super::AsyncDispatcher;

    #[test]
    fn runs_submitted_work() {
        let dispatcher = AsyncDispatcher::new(2, 10);
        let (sender, receiver) = channel();

        for index in 0..5 {
            let sender = sender.clone();
            assert!(dispatcher.submit(Box::new(move || sender.send(index).unwrap())));
        }
        drop(sender);
        dispatcher.close(Duration::from_secs(5));

        let mut delivered: Vec<i32> = receiver.iter().collect();
        delivered.sort_unstable();
        assert_eq!(vec![0, 1, 2, 3, 4], delivered);
    }

    #[test]
    fn drops_the_oldest_queued_task_when_full() {
        // One worker, held on a gate, so everything else has to queue.
        let dispatcher = AsyncDispatcher::new(1, 2);
        let (release, held) = sync_channel::<()>(0);
        let (started, worker_started) = sync_channel::<()>(0);
        dispatcher.submit(Box::new(move || {
            started.send(()).unwrap();
            held.recv().unwrap();
        }));
        worker_started.recv().unwrap();

        let ran = Arc::new(Mutex::new(Vec::new()));
        for name in ["oldest", "middle", "newest"] {
            let ran = Arc::clone(&ran);
            dispatcher.submit(Box::new(move || ran.lock().unwrap().push(name)));
        }

        release.send(()).unwrap();
        dispatcher.close(Duration::from_secs(5));

        let ran = ran.lock().unwrap();
        assert_eq!(
            2,
            ran.len(),
            "the queue holds two tasks, so one must be dropped: {ran:?}"
        );
        assert!(
            !ran.contains(&"oldest"),
            "the oldest queued task must be the one dropped: {ran:?}"
        );
    }

    #[test]
    fn refuses_work_after_close_and_close_is_idempotent() {
        let dispatcher = AsyncDispatcher::new(1, 4);
        dispatcher.close(Duration::from_secs(1));
        dispatcher.close(Duration::from_secs(1));

        assert!(!dispatcher.submit(Box::new(|| unreachable!("a closed dispatcher must refuse work"))));
    }

    #[test]
    fn close_gives_up_on_work_that_outlasts_the_drain_timeout() {
        let dispatcher = AsyncDispatcher::new(1, 10);
        let (release, held) = sync_channel::<()>(0);
        let (started, worker_started) = sync_channel::<()>(0);
        dispatcher.submit(Box::new(move || {
            started.send(()).unwrap();
            held.recv().unwrap();
        }));
        worker_started.recv().unwrap();

        let ran = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&ran);
        dispatcher.submit(Box::new(move || {
            counter.fetch_add(1, Ordering::Release);
        }));

        let started_closing = Instant::now();
        dispatcher.close(Duration::from_millis(100));
        let elapsed = started_closing.elapsed();

        assert!(
            elapsed < Duration::from_secs(5),
            "close() waited {elapsed:?}, well past its timeout"
        );
        assert_eq!(0, ran.load(Ordering::Acquire), "an abandoned task must not run");
        drop(release);
    }
}
