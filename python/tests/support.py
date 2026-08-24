"""Loopback HTTP server used to exercise the transport without leaving the host."""

from __future__ import absolute_import

import socket
import threading
import time

try:  # Python 3
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from socketserver import ThreadingMixIn
except ImportError:  # Python 2
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer
    from SocketServer import ThreadingMixIn

PATH = "/api/v1/incident/post"


class RecordedRequest(object):
    def __init__(self, path, api_key, content_type, user_agent, body):
        self.path = path
        self.api_key = api_key
        self.content_type = content_type
        self.user_agent = user_agent
        self.body = body


class _Handler(BaseHTTPRequestHandler):
    # Keep-alive is part of what the connection pool is being tested for.
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length).decode("utf-8") if length else ""
        self.server.record(RecordedRequest(
            self.path,
            self.headers.get("X-API-KEY", None),
            self.headers.get("Content-Type", None),
            self.headers.get("User-Agent", None),
            body,
        ))
        status, payload, close_connection = self.server.next_response()
        data = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        if close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


class _Server(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class FakeOppex(object):
    """A scripted Oppex endpoint.

    Responses are consumed in order; the last one repeats once the script runs out.
    """

    def __init__(self, responses=None):
        self._responses = list(responses or [(200, '{"success":true,"code":200,"data":"inc-1"}', False)])
        self._requests = []
        self._lock = threading.Lock()
        self._server = _Server(("127.0.0.1", 0), _Handler)
        self._server.record = self._record
        self._server.next_response = self._next_response
        # A short poll interval keeps shutdown() from dominating test runtime.
        self._thread = threading.Thread(target=self._server.serve_forever, args=(0.02,))
        self._thread.daemon = True
        self._thread.start()

    @property
    def endpoint(self):
        host, port = self._server.server_address[:2]
        return "http://%s:%d%s" % (host, port, PATH)

    @property
    def requests(self):
        with self._lock:
            return list(self._requests)

    def wait_for_requests(self, count, timeout_seconds=5.0):
        """Waits for ``count`` recorded requests and returns them."""
        deadline = time.time() + timeout_seconds
        while True:
            recorded = self.requests
            if len(recorded) >= count or time.time() >= deadline:
                return recorded
            time.sleep(0.02)

    def close(self):
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(5.0)

    def _record(self, request):
        with self._lock:
            self._requests.append(request)

    def _next_response(self):
        with self._lock:
            if len(self._responses) > 1:
                return self._responses.pop(0)
            return self._responses[0]


def unreachable_endpoint():
    """Returns an endpoint on a port that refuses connections."""
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    return "http://127.0.0.1:%d%s" % (port, PATH)
