"""Internal error types. Not part of the supported SDK API."""

from __future__ import absolute_import


class TransportError(Exception):
    """A recoverable transport failure that carries no HTTP status.

    The transport raises this instead of leaking socket, TLS or protocol
    exceptions, which keeps the retry policy independent of the HTTP client.
    """

    def __init__(self, cause):
        Exception.__init__(self, str(cause))
        self.cause = cause
