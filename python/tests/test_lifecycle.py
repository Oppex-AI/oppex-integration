"""Concurrent delivery admission and draining close."""

from __future__ import absolute_import

import threading
import unittest

from oppex_sdk._internal.lifecycle import Lifecycle


class LifecycleTest(unittest.TestCase):
    def test_admits_concurrent_operations(self):
        lifecycle = Lifecycle()
        self.assertTrue(lifecycle.begin())
        self.assertTrue(lifecycle.begin())
        lifecycle.end()
        lifecycle.end()
        self.assertFalse(lifecycle.closed)

    def test_close_waits_for_an_in_flight_operation(self):
        lifecycle = Lifecycle()
        self.assertTrue(lifecycle.begin())
        closed = threading.Event()

        def close():
            lifecycle.begin_close()
            closed.set()

        closer = threading.Thread(target=close)
        closer.daemon = True
        closer.start()
        self.assertFalse(closed.wait(0.2))
        lifecycle.end()
        self.assertTrue(closed.wait(5.0))
        closer.join(5.0)

    def test_close_gives_up_on_a_stuck_operation(self):
        lifecycle = Lifecycle(drain_timeout_seconds=0.05)
        self.assertTrue(lifecycle.begin())
        self.assertTrue(lifecycle.begin_close())
        self.assertTrue(lifecycle.closed)

    def test_refuses_operations_once_closed(self):
        lifecycle = Lifecycle()
        self.assertTrue(lifecycle.begin_close())
        self.assertFalse(lifecycle.begin())

    def test_only_one_caller_owns_the_close(self):
        lifecycle = Lifecycle()
        self.assertTrue(lifecycle.begin_close())
        self.assertFalse(lifecycle.begin_close())


if __name__ == "__main__":
    unittest.main()
