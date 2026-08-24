"""Internal counters. Not part of the supported SDK API."""

from __future__ import absolute_import

import threading


class _Counter(object):
    """A thread-safe counter. Python has no atomic integer, so a lock guards it."""

    __slots__ = ("_lock", "_value")

    def __init__(self):
        self._lock = threading.Lock()
        self._value = 0

    def add(self, delta):
        with self._lock:
            self._value += delta

    @property
    def value(self):
        with self._lock:
            return self._value


class InternalMetrics(object):
    """Delivery counters used for diagnostics and rate-limited drop reporting."""

    _NAMES = ("queued", "processed", "successful", "failed", "retried", "dropped")

    def __init__(self):
        self._counters = dict((name, _Counter()) for name in self._NAMES)

    def increment_queued(self):
        self._counters["queued"].add(1)

    def decrement_queued(self):
        self._counters["queued"].add(-1)

    def increment_processed(self):
        self._counters["processed"].add(1)

    def increment_successful(self):
        self._counters["successful"].add(1)

    def increment_failed(self):
        self._counters["failed"].add(1)

    def increment_retried(self):
        self._counters["retried"].add(1)

    def increment_dropped(self):
        self._counters["dropped"].add(1)

    @property
    def queued(self):
        return self._counters["queued"].value

    @property
    def processed(self):
        return self._counters["processed"].value

    @property
    def successful(self):
        return self._counters["successful"].value

    @property
    def failed(self):
        return self._counters["failed"].value

    @property
    def retried(self):
        return self._counters["retried"].value

    @property
    def dropped(self):
        return self._counters["dropped"].value
