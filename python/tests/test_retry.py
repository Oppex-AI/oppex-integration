"""Retry classification and backoff schedule."""

from __future__ import absolute_import

import unittest

from oppex_sdk._internal.errors import TransportError
from oppex_sdk._internal.metrics import InternalMetrics
from oppex_sdk._internal.retry import DEFAULT_DELAYS_SECONDS, RetryExecutor
from oppex_sdk.exceptions import IncidentException


class _RecordingSleeper(object):
    """Records requested delays instead of waiting, and can report an interruption."""

    def __init__(self, interrupt_after=None):
        self.delays = []
        self._interrupt_after = interrupt_after

    def __call__(self, seconds):
        self.delays.append(seconds)
        return self._interrupt_after is not None and len(self.delays) > self._interrupt_after


class _Operation(object):
    """Raises the scripted failures in order, then returns ``result``."""

    def __init__(self, failures, result="delivered"):
        self._failures = list(failures)
        self._result = result
        self.attempts = 0

    def __call__(self):
        self.attempts += 1
        if self._failures:
            raise self._failures.pop(0)
        return self._result


class RetryExecutorTest(unittest.TestCase):
    def setUp(self):
        self.metrics = InternalMetrics()
        self.sleeper = _RecordingSleeper()

    def _executor(self, delays=None, sleeper=None):
        return RetryExecutor(self.metrics, delays_seconds=delays,
                             sleeper=self.sleeper if sleeper is None else sleeper)

    def test_returns_the_first_successful_result(self):
        operation = _Operation([])
        self.assertEqual("delivered", self._executor().execute(operation))
        self.assertEqual(1, operation.attempts)
        self.assertEqual([], self.sleeper.delays)
        self.assertEqual(0, self.metrics.retried)

    def test_retries_a_retryable_failure_until_it_succeeds(self):
        operation = _Operation([IncidentException("busy", status_code=503, retryable=True)] * 2)
        self.assertEqual("delivered", self._executor().execute(operation))
        self.assertEqual(3, operation.attempts)
        self.assertEqual([0.5, 1.0], self.sleeper.delays)
        self.assertEqual(2, self.metrics.retried)

    def test_uses_the_documented_backoff_schedule(self):
        failure = IncidentException("busy", status_code=503, retryable=True)
        operation = _Operation([failure] * 10)
        self.assertRaises(IncidentException, self._executor().execute, operation)
        self.assertEqual(list(DEFAULT_DELAYS_SECONDS), self.sleeper.delays)
        self.assertEqual(len(DEFAULT_DELAYS_SECONDS) + 1, operation.attempts)

    def test_reraises_the_original_failure_after_exhausting_retries(self):
        failure = IncidentException("busy", status_code=503, retryable=True)
        try:
            self._executor(delays=(0.0,)).execute(_Operation([failure, failure]))
            self.fail("Expected an IncidentException")
        except IncidentException as raised:
            self.assertIs(failure, raised)

    def test_does_not_retry_a_non_retryable_failure(self):
        operation = _Operation([IncidentException("bad request", status_code=400, retryable=False)])
        self.assertRaises(IncidentException, self._executor().execute, operation)
        self.assertEqual(1, operation.attempts)
        self.assertEqual([], self.sleeper.delays)

    def test_retries_a_transport_failure(self):
        operation = _Operation([TransportError(IOError("connection reset"))])
        self.assertEqual("delivered", self._executor().execute(operation))
        self.assertEqual(2, operation.attempts)

    def test_wraps_an_exhausted_transport_failure(self):
        cause = IOError("connection reset")
        operation = _Operation([TransportError(cause)] * 3)
        try:
            self._executor(delays=(0.0, 0.0)).execute(operation)
            self.fail("Expected an IncidentException")
        except IncidentException as failure:
            self.assertEqual("Incident delivery failed after 3 attempts", str(failure))
            self.assertEqual(-1, failure.status_code)
            self.assertFalse(failure.retryable)
            self.assertIs(cause, failure.cause)

    def test_stops_when_a_shutdown_interrupts_the_backoff(self):
        sleeper = _RecordingSleeper(interrupt_after=0)
        operation = _Operation([IncidentException("busy", status_code=503, retryable=True)] * 3)
        try:
            self._executor(sleeper=sleeper).execute(operation)
            self.fail("Expected an IncidentException")
        except IncidentException as failure:
            self.assertEqual("Incident delivery interrupted during retry", str(failure))
        self.assertEqual(1, operation.attempts)

    def test_rejects_a_missing_operation(self):
        self.assertRaises(ValueError, self._executor().execute, None)


if __name__ == "__main__":
    unittest.main()
