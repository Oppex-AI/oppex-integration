"""Transport behaviour against a loopback endpoint."""

from __future__ import absolute_import

import json
import socket
import unittest

from oppex_sdk._internal.errors import TransportError
from oppex_sdk._internal.http_executor import HttpExecutor
from oppex_sdk.exceptions import IncidentException
from oppex_sdk.model import IncidentRequest, Severity

from tests import support


def _request(**overrides):
    arguments = {"title": "title", "source": "source", "severity": Severity.MEDIUM,
                 "src_timestamp": 1700000000000}
    arguments.update(overrides)
    return IncidentRequest(**arguments)


class _StaleConnection(object):
    """Stands in for a keep-alive connection the server closed while it was idle."""

    def __init__(self):
        self.closed = False

    def request(self, *args, **kwargs):
        raise socket.error("connection reset by peer")

    def close(self):
        self.closed = True


class HttpExecutorTest(unittest.TestCase):
    def setUp(self):
        self.oppex = None
        self.executor = None

    def tearDown(self):
        if self.executor is not None:
            self.executor.close()
        if self.oppex is not None:
            self.oppex.close()

    def _start(self, responses=None, api_key="secret"):
        self.oppex = support.FakeOppex(responses)
        self.executor = HttpExecutor(api_key, self.oppex.endpoint)
        return self.executor

    def test_posts_json_with_the_api_key_and_parses_the_response(self):
        executor = self._start([(200, '{"success":true,"code":200,"message":"created","data":"inc-1"}', False)])
        response = executor.execute(_request(), "service-key")

        self.assertTrue(response.successful)
        self.assertEqual(200, response.code)
        self.assertEqual("created", response.message)
        self.assertEqual("inc-1", response.incident_id)

        recorded = self.oppex.requests[0]
        self.assertEqual(support.PATH, recorded.path)
        self.assertEqual("secret", recorded.api_key)
        self.assertEqual("application/json; charset=UTF-8", recorded.content_type)
        self.assertTrue(recorded.user_agent.startswith("oppex-integration-sdk-python/"))
        self.assertEqual("service-key", json.loads(recorded.body)["serviceKey"])

    def test_omits_the_service_key_when_service_routing_is_used(self):
        executor = self._start()
        executor.execute(_request(), None)
        self.assertNotIn("serviceKey", json.loads(self.oppex.requests[0].body))

    def test_reuses_a_pooled_connection(self):
        executor = self._start()
        executor.execute(_request(), "service-key")
        executor.execute(_request(), "service-key")
        self.assertEqual(2, len(self.oppex.requests))

    def test_recovers_when_the_server_closes_the_connection(self):
        executor = self._start([(200, '{"success":true,"code":200}', True)])
        executor.execute(_request(), "service-key")
        response = executor.execute(_request(), "service-key")
        self.assertTrue(response.successful)
        self.assertEqual(2, len(self.oppex.requests))

    def test_recovers_when_a_pooled_connection_is_stale(self):
        executor = self._start()
        stale = _StaleConnection()
        executor._pool.append(stale)

        response = executor.execute(_request(), "service-key")

        self.assertTrue(response.successful)
        self.assertTrue(stale.closed)
        self.assertEqual(1, len(self.oppex.requests))

    def test_marks_server_errors_retryable(self):
        for status in (429, 500, 502, 503, 504):
            self.tearDown()
            executor = self._start([(status, '{"success":false,"message":"busy"}', False)])
            try:
                executor.execute(_request(), "service-key")
                self.fail("Expected an IncidentException for HTTP %d" % status)
            except IncidentException as failure:
                self.assertEqual(status, failure.status_code)
                self.assertTrue(failure.retryable)
                self.assertEqual("Oppex returned HTTP %d: busy" % status, str(failure))

    def test_marks_client_errors_non_retryable(self):
        executor = self._start([(401, '{"success":false,"message":"unauthorized"}', False)])
        try:
            executor.execute(_request(), "service-key")
            self.fail("Expected an IncidentException")
        except IncidentException as failure:
            self.assertEqual(401, failure.status_code)
            self.assertFalse(failure.retryable)

    def test_uses_the_status_alone_when_an_error_body_is_not_json(self):
        executor = self._start([(500, "<html>gateway</html>", False)])
        try:
            executor.execute(_request(), "service-key")
            self.fail("Expected an IncidentException")
        except IncidentException as failure:
            self.assertEqual("Oppex returned HTTP 500", str(failure))

    def test_reports_an_unreachable_endpoint_as_a_transport_failure(self):
        executor = HttpExecutor("secret", support.unreachable_endpoint())
        try:
            self.assertRaises(TransportError, executor.execute, _request(), "service-key")
        finally:
            executor.close()

    def test_refuses_to_post_after_close(self):
        executor = self._start()
        executor.close()
        self.assertRaises(IncidentException, executor.execute, _request(), "service-key")

    def test_close_is_idempotent(self):
        executor = self._start()
        executor.execute(_request(), "service-key")
        executor.close()
        executor.close()

    def test_rejects_an_unsupported_endpoint(self):
        self.assertRaises(ValueError, HttpExecutor, "secret", "ftp://example.com/incident")
        self.assertRaises(ValueError, HttpExecutor, "secret", "https:///incident")


if __name__ == "__main__":
    unittest.main()
