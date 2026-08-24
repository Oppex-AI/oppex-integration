"""Internal bounded asynchronous dispatcher. Not part of the supported SDK API."""

from __future__ import absolute_import

import logging
import threading
import time

from oppex_sdk._compat import monotonic, queue_module

LOGGER = logging.getLogger(__name__)

WORKER_COUNT = 2
QUEUE_CAPACITY = 5000
SHUTDOWN_TIMEOUT_SECONDS = 10.0
DROP_LOG_INTERVAL_SECONDS = 60.0

_POLL_INTERVAL_SECONDS = 0.1
_FORCED_JOIN_SECONDS = 1.0
_CLOSED_MESSAGE = "IncidentClient is closed"


class RateLimitedDropLogger(object):
    """Reports dropped incidents at most once per interval.

    A saturated queue drops continuously, so per-drop logging would replace one
    overload with another.
    """

    def __init__(self, logger=None, clock=None, interval_seconds=DROP_LOG_INTERVAL_SECONDS):
        self._logger = LOGGER if logger is None else logger
        self._clock = time.time if clock is None else clock
        self._interval_seconds = interval_seconds
        self._lock = threading.Lock()
        self._interval_started_at = self._clock()
        self._dropped_in_interval = 0

    def record_drop(self):
        with self._lock:
            self._dropped_in_interval += 1
            now = self._clock()
            if now - self._interval_started_at < self._interval_seconds:
                return
            self._interval_started_at = now
            count = self._dropped_in_interval
            self._dropped_in_interval = 0
        if count > 0:
            self._logger.warning("Dropped %d incidents in the last %g seconds.",
                                 count, self._interval_seconds)


class _TrackedTask(object):
    """Keeps the queue depth accurate whether a task runs or is dropped."""

    def __init__(self, delegate, metrics, drop_logger):
        self._delegate = delegate
        self._metrics = metrics
        self._drop_logger = drop_logger
        self._lock = threading.Lock()
        self._started_or_dropped = False

    def run(self):
        if not self._claim():
            return
        self._metrics.decrement_queued()
        self._delegate()

    def drop(self):
        if not self._claim():
            return
        self._metrics.decrement_queued()
        self._metrics.increment_dropped()
        self._drop_logger.record_drop()

    def _claim(self):
        with self._lock:
            if self._started_or_dropped:
                return False
            self._started_or_dropped = True
            return True


class AsyncDispatcher(object):
    """Runs best-effort deliveries on a fixed pool of daemon worker threads.

    The queue is bounded. When it is full the oldest queued incident is dropped
    so the newest one still gets a chance, and submission never blocks the
    calling application.
    """

    def __init__(self, metrics, shutdown_signal=None, worker_count=WORKER_COUNT,
                 queue_capacity=QUEUE_CAPACITY, drop_logger=None,
                 shutdown_timeout_seconds=SHUTDOWN_TIMEOUT_SECONDS):
        self._metrics = metrics
        self._shutdown_signal = threading.Event() if shutdown_signal is None else shutdown_signal
        self._drop_logger = RateLimitedDropLogger() if drop_logger is None else drop_logger
        self._shutdown_timeout_seconds = shutdown_timeout_seconds
        self._queue = queue_module.Queue(maxsize=queue_capacity)
        self._stopping = threading.Event()
        self._close_lock = threading.Lock()
        self._closed = False
        self._submit_lock = threading.Lock()
        self._workers = [self._start_worker(index + 1) for index in range(worker_count)]

    def submit(self, task):
        """Queues ``task``, dropping the oldest queued task when the queue is full."""
        if task is None:
            raise ValueError("task must not be None")
        if self._stopping.is_set():
            raise RuntimeError(_CLOSED_MESSAGE)

        tracked = _TrackedTask(task, self._metrics, self._drop_logger)
        self._metrics.increment_queued()
        with self._submit_lock:
            if self._offer(tracked):
                return
            oldest = self._poll()
            if oldest is not None:
                oldest.drop()
            if self._stopping.is_set() or not self._offer(tracked):
                tracked.drop()

    def close(self):
        """Drains queued work for a bounded period, then drops whatever is left."""
        with self._close_lock:
            if self._closed:
                return
            self._closed = True

        self._stopping.set()
        deadline = monotonic() + self._shutdown_timeout_seconds
        for worker in self._workers:
            worker.join(max(0.0, deadline - monotonic()))

        if any(worker.is_alive() for worker in self._workers):
            # The graceful window expired: stop in-flight retry backoff rather
            # than delaying application shutdown any further.
            self._shutdown_signal.set()
        # Nothing may stay queued once a close returns.
        self._drain_pending()
        for worker in self._workers:
            worker.join(_FORCED_JOIN_SECONDS)

    def _start_worker(self, sequence):
        worker = threading.Thread(target=self._work, name="oppex-incident-worker-%d" % sequence)
        worker.daemon = True
        worker.start()
        return worker

    def _work(self):
        while True:
            try:
                task = self._queue.get(True, _POLL_INTERVAL_SECONDS)
            except queue_module.Empty:
                if self._stopping.is_set():
                    return
                continue
            try:
                task.run()
            except Exception:
                # A worker must outlive any single failed delivery.
                LOGGER.debug("Oppex incident worker task failed", exc_info=True)

    def _drain_pending(self):
        while True:
            task = self._poll()
            if task is None:
                return
            task.drop()

    def _offer(self, tracked):
        try:
            self._queue.put_nowait(tracked)
            return True
        except queue_module.Full:
            return False

    def _poll(self):
        try:
            return self._queue.get_nowait()
        except queue_module.Empty:
            return None
