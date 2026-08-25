"""Public exception type raised by incident delivery."""

from __future__ import absolute_import


class IncidentException(Exception):
    """Raised when an incident could not be delivered to Oppex.

    ``status_code`` is the HTTP status, or ``-1`` when no HTTP response was
    received. ``retryable`` reports whether the underlying failure is eligible
    for retry; the SDK has already exhausted its own retries by the time this
    exception reaches a caller.
    """

    def __init__(self, message, cause=None, status_code=-1, retryable=False):
        Exception.__init__(self, message)
        self._cause = cause
        self._status_code = status_code
        self._retryable = bool(retryable)

    @property
    def cause(self):
        """Returns the underlying exception, or ``None``.

        Python 2 has no implicit exception chaining, so the cause is kept
        explicitly to give both interpreters the same diagnostics.
        """
        return self._cause

    @property
    def status_code(self):
        return self._status_code

    @property
    def retryable(self):
        return self._retryable
