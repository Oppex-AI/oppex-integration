"""Internal retry policy. Not part of the supported SDK API."""

from __future__ import absolute_import

import time

from oppex_sdk._internal.errors import TransportError
from oppex_sdk.exceptions import IncidentException

DEFAULT_DELAYS_SECONDS = (0.5, 1.0, 2.0, 4.0, 8.0)


def uninterruptible_sleeper(seconds):
    """Sleeps and reports that the wait completed rather than being cut short."""
    time.sleep(seconds)
    return False


class RetryExecutor(object):
    """Retries an operation with a fixed exponential backoff schedule.

    A sleeper returns ``True`` when a shutdown cut the wait short, which is this
    SDK's stand-in for the thread interruption the Java SDK relies on.
    """

    def __init__(self, metrics, delays_seconds=None, sleeper=None):
        self._metrics = metrics
        self._delays = tuple(DEFAULT_DELAYS_SECONDS if delays_seconds is None else delays_seconds)
        self._sleeper = uninterruptible_sleeper if sleeper is None else sleeper

    def execute(self, operation):
        """Runs ``operation`` on the calling thread, including any retry delays."""
        if operation is None:
            raise ValueError("operation must not be None")

        retry = 0
        while True:
            try:
                return operation()
            except IncidentException as failure:
                if not failure.retryable or retry >= len(self._delays):
                    raise
            except TransportError as failure:
                if retry >= len(self._delays):
                    raise IncidentException(
                        "Incident delivery failed after %d attempts" % (retry + 1),
                        cause=failure.cause,
                        status_code=-1,
                        retryable=False,
                    )
            self._wait_before_retry(self._delays[retry])
            retry += 1

    def _wait_before_retry(self, delay_seconds):
        self._metrics.increment_retried()
        if self._sleeper(delay_seconds):
            raise IncidentException("Incident delivery interrupted during retry")
