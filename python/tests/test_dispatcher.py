"""Bounded asynchronous dispatch, drop accounting and shutdown."""

from __future__ import absolute_import

import threading
import time
import unittest

from oppex_sdk._internal.dispatcher import AsyncDispatcher, RateLimitedDropLogger
from oppex_sdk._internal.metrics import InternalMetrics


class _CollectingLogger(object):
    def __init__(self):
        self.messages = []

    def warning(self, fmt, *args):
        self.messages.append(fmt % args)


class _FakeClock(object):
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class RateLimitedDropLoggerTest(unittest.TestCase):
    def setUp(self):
        self.logger = _CollectingLogger()
        self.clock = _FakeClock()
        self.drop_logger = RateLimitedDropLogger(self.logger, self.clock, 60.0)

    def test_stays_silent_inside_the_interval(self):
        for _ in range(100):
            self.drop_logger.record_drop()
        self.assertEqual([], self.logger.messages)

    def test_reports_once_the_interval_elapses(self):
        for _ in range(4):
            self.drop_logger.record_drop()
        self.clock.advance(61.0)
        self.drop_logger.record_drop()
        self.assertEqual(["Dropped 5 incidents in the last 60 seconds."], self.logger.messages)

    def test_starts_a_new_interval_after_reporting(self):
        self.drop_logger.record_drop()
        self.clock.advance(61.0)
        self.drop_logger.record_drop()
        self.drop_logger.record_drop()
        self.assertEqual(1, len(self.logger.messages))
        self.clock.advance(61.0)
        self.drop_logger.record_drop()
        self.assertEqual(["Dropped 2 incidents in the last 60 seconds.",
                          "Dropped 2 incidents in the last 60 seconds."], self.logger.messages)


class AsyncDispatcherTest(unittest.TestCase):
    def setUp(self):
        self.metrics = InternalMetrics()
        self.dispatcher = None

    def tearDown(self):
        if self.dispatcher is not None:
            self.dispatcher.close()

    def test_runs_a_submitted_task(self):
        done = threading.Event()
        self.dispatcher = AsyncDispatcher(self.metrics)
        self.dispatcher.submit(done.set)
        self.assertTrue(done.wait(5.0))
        self.dispatcher.close()
        self.assertEqual(0, self.metrics.queued)
        self.assertEqual(0, self.metrics.dropped)

    def test_a_failing_task_does_not_stop_the_workers(self):
        done = threading.Event()

        def boom():
            raise RuntimeError("delivery blew up")

        self.dispatcher = AsyncDispatcher(self.metrics, worker_count=1)
        self.dispatcher.submit(boom)
        self.dispatcher.submit(done.set)
        self.assertTrue(done.wait(5.0))

    def test_drops_the_oldest_task_when_the_queue_is_full(self):
        run = []
        self.dispatcher = AsyncDispatcher(self.metrics, worker_count=0, queue_capacity=2)
        for index in range(4):
            self.dispatcher.submit(lambda index=index: run.append(index))

        self.assertEqual(2, self.metrics.dropped)
        self.assertEqual(2, self.metrics.queued)
        self.dispatcher.close()
        self.assertEqual(4, self.metrics.dropped)
        self.assertEqual(0, self.metrics.queued)
        self.assertEqual([], run)

    def test_reports_drops_through_the_drop_logger(self):
        logger = _CollectingLogger()
        clock = _FakeClock()
        self.dispatcher = AsyncDispatcher(
            self.metrics, worker_count=0, queue_capacity=1,
            drop_logger=RateLimitedDropLogger(logger, clock, 60.0))
        self.dispatcher.submit(lambda: None)
        self.dispatcher.submit(lambda: None)
        clock.advance(61.0)
        self.dispatcher.submit(lambda: None)
        self.assertEqual(["Dropped 2 incidents in the last 60 seconds."], logger.messages)

    def test_drains_queued_tasks_on_close(self):
        started = threading.Event()
        release = threading.Event()
        run = []

        def slow():
            started.set()
            release.wait(5.0)
            run.append("slow")

        self.dispatcher = AsyncDispatcher(self.metrics, worker_count=1)
        self.dispatcher.submit(slow)
        self.assertTrue(started.wait(5.0))
        self.dispatcher.submit(lambda: run.append("queued"))
        release.set()
        self.dispatcher.close()
        self.assertEqual(["slow", "queued"], run)
        self.assertEqual(0, self.metrics.dropped)

    def test_signals_a_forced_shutdown_when_the_grace_period_expires(self):
        shutdown_signal = threading.Event()
        release = threading.Event()
        self.dispatcher = AsyncDispatcher(
            self.metrics, shutdown_signal=shutdown_signal, worker_count=1,
            shutdown_timeout_seconds=0.05)
        self.dispatcher.submit(lambda: release.wait(5.0))
        time.sleep(0.05)
        self.dispatcher.submit(lambda: None)
        self.dispatcher.close()

        self.assertTrue(shutdown_signal.is_set())
        self.assertEqual(1, self.metrics.dropped)
        release.set()

    def test_refuses_a_submission_after_close(self):
        self.dispatcher = AsyncDispatcher(self.metrics)
        self.dispatcher.close()
        self.assertRaises(RuntimeError, self.dispatcher.submit, lambda: None)

    def test_rejects_a_missing_task(self):
        self.dispatcher = AsyncDispatcher(self.metrics)
        self.assertRaises(ValueError, self.dispatcher.submit, None)

    def test_close_is_idempotent(self):
        self.dispatcher = AsyncDispatcher(self.metrics)
        self.dispatcher.close()
        self.dispatcher.close()


if __name__ == "__main__":
    unittest.main()
