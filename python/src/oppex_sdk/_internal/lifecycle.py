"""Internal lifecycle guard. Not part of the supported SDK API."""

from __future__ import absolute_import

import threading

from oppex_sdk._compat import monotonic

DRAIN_TIMEOUT_SECONDS = 10.0
_WAIT_SLICE_SECONDS = 0.05


class Lifecycle(object):
    """Lets deliveries run concurrently while closing waits for them to finish.

    This is the read/write split the Java SDK gets from a reentrant read-write
    lock: any number of deliveries may hold the resource at once, and a close
    stops admitting new ones and then drains. The drain is bounded so a hung
    delivery delays a close instead of blocking it forever.
    """

    def __init__(self, drain_timeout_seconds=DRAIN_TIMEOUT_SECONDS):
        self._condition = threading.Condition()
        self._drain_timeout_seconds = drain_timeout_seconds
        self._active = 0
        self._closed = False

    @property
    def closed(self):
        with self._condition:
            return self._closed

    def begin(self):
        """Admits one operation. Returns ``False`` when the client is closed."""
        with self._condition:
            if self._closed:
                return False
            self._active += 1
            return True

    def end(self):
        with self._condition:
            self._active -= 1
            if self._active <= 0:
                self._condition.notify_all()

    def begin_close(self):
        """Stops admitting operations and drains in-flight ones.

        Returns ``True`` for the single caller that owns the shutdown, so
        repeated ``close()`` calls release resources exactly once.
        """
        with self._condition:
            if self._closed:
                return False
            self._closed = True
            deadline = monotonic() + self._drain_timeout_seconds
            while self._active > 0:
                remaining = deadline - monotonic()
                if remaining <= 0:
                    break
                self._condition.wait(min(remaining, _WAIT_SLICE_SECONDS))
            return True
