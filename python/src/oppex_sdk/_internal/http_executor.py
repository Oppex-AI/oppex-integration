"""Internal HTTP transport. Not part of the supported SDK API."""

from __future__ import absolute_import

import collections
import socket
import ssl
import threading

from oppex_sdk._compat import http_client, to_native_str, urlsplit
from oppex_sdk._internal.errors import TransportError
from oppex_sdk._internal.json_codec import JsonCodec
from oppex_sdk._version import __version__
from oppex_sdk.exceptions import IncidentException

CONNECT_TIMEOUT_SECONDS = 3.0
SOCKET_TIMEOUT_SECONDS = 5.0
MAX_POOLED_CONNECTIONS = 20

_RETRYABLE_STATUS = frozenset([429, 500, 502, 503, 504])
_TRANSPORT_ERRORS = (socket.error, ssl.SSLError, http_client.HTTPException)
_CLOSED_MESSAGE = "IncidentClient is closed"


class HttpExecutor(object):
    """Posts an incident over a pool of keep-alive connections.

    The pool hands out an idle connection when one is available and opens a new
    one otherwise, so a burst never blocks waiting for a permit. Connections
    beyond :data:`MAX_POOLED_CONNECTIONS` are closed on release rather than kept.
    """

    def __init__(self, api_key, endpoint):
        parts = urlsplit(endpoint)
        if parts.scheme not in ("http", "https"):
            raise ValueError("endpoint must use http or https")
        if not parts.hostname:
            raise ValueError("endpoint must include a host")

        self._scheme = parts.scheme
        self._host = parts.hostname
        self._port = parts.port
        self._path = to_native_str(parts.path or "/")
        if parts.query:
            self._path = self._path + "?" + to_native_str(parts.query)
        self._ssl_context = _ssl_context() if self._scheme == "https" else None
        self._headers = {
            to_native_str("Accept"): to_native_str("application/json"),
            to_native_str("Content-Type"): to_native_str("application/json; charset=UTF-8"),
            to_native_str("X-API-KEY"): to_native_str(api_key),
            to_native_str("User-Agent"): to_native_str("oppex-integration-sdk-python/" + __version__),
        }
        self._codec = JsonCodec()
        self._lock = threading.Lock()
        self._pool = collections.deque()
        self._closed = False

    def execute(self, request, default_service_key):
        """Posts one incident and returns the parsed response.

        Raises ``IncidentException`` for an HTTP error status and
        ``TransportError`` for a failure that never reached a status line.
        """
        if self._closed:
            raise IncidentException(_CLOSED_MESSAGE)

        body = self._codec.serialize(request, default_service_key).encode("utf-8")
        pooled = self._take_pooled()
        if pooled is not None:
            try:
                return self._exchange(pooled, body)
            except TransportError:
                # A server may close an idle keep-alive connection at any time. One
                # fresh attempt recovers from that without counting as a delivery retry.
                pass
        return self._exchange(self._open_connection(), body)

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
            pending = list(self._pool)
            self._pool.clear()
        for connection in pending:
            _close_quietly(connection)

    def _exchange(self, connection, body):
        reusable = False
        try:
            try:
                connection.request("POST", self._path, body=body, headers=self._headers)
                response = connection.getresponse()
                status = response.status
                raw_body = response.read()
                reusable = not response.will_close
            except _TRANSPORT_ERRORS as failure:
                raise TransportError(failure)

            text = raw_body.decode("utf-8", "replace") if raw_body else None
            if 200 <= status < 300:
                return self._codec.parse_response(text, status)
            raise IncidentException(
                self._error_message(text, status),
                status_code=status,
                retryable=status in _RETRYABLE_STATUS,
            )
        finally:
            if reusable:
                self._offer(connection)
            else:
                _close_quietly(connection)

    def _error_message(self, text, status):
        message = "Oppex returned HTTP %d" % status
        if not text or not text.strip():
            return message
        try:
            error = self._codec.parse_response(text, status)
        except IncidentException:
            # The status code remains sufficient when an error response is not JSON.
            return message
        if error.message and error.message.strip():
            return message + ": " + error.message
        return message

    def _open_connection(self):
        try:
            if self._ssl_context is not None:
                connection = http_client.HTTPSConnection(
                    self._host,
                    port=self._port,
                    timeout=CONNECT_TIMEOUT_SECONDS,
                    context=self._ssl_context,
                )
            else:
                connection = http_client.HTTPConnection(
                    self._host, port=self._port, timeout=CONNECT_TIMEOUT_SECONDS
                )
            connection.connect()
            # The constructor timeout covers connect; reads and writes get their own budget.
            connection.sock.settimeout(SOCKET_TIMEOUT_SECONDS)
            return connection
        except _TRANSPORT_ERRORS as failure:
            raise TransportError(failure)

    def _take_pooled(self):
        with self._lock:
            if self._closed:
                return None
            try:
                # Most recently released first: the freshest connection is the
                # least likely to have been closed by the server while idle.
                return self._pool.pop()
            except IndexError:
                return None

    def _offer(self, connection):
        with self._lock:
            keep = not self._closed and len(self._pool) < MAX_POOLED_CONNECTIONS
            if keep:
                self._pool.append(connection)
        if not keep:
            _close_quietly(connection)


def _ssl_context():
    create_default_context = getattr(ssl, "create_default_context", None)
    if create_default_context is None:
        raise RuntimeError(
            "This Python build cannot verify TLS certificates; "
            "Python 2.7.9 or newer is required for HTTPS endpoints"
        )
    return create_default_context()


def _close_quietly(connection):
    try:
        connection.close()
    except Exception:
        # A close failure must not mask the HTTP result that is already in hand.
        pass
