"""End-to-end client behaviour against a loopback endpoint."""

from __future__ import absolute_import

import json
import unittest

from oppex_sdk import IncidentClient, IncidentException, IncidentRequest, Severity

from tests import support

_OK = (200, '{"success":true,"code":200,"message":"created","data":"inc-1"}', False)


def _request(**overrides):
    arguments = {"title": "title", "source": "source", "severity": Severity.MEDIUM}
    arguments.update(overrides)
    return IncidentRequest(**arguments)


class IncidentClientTest(unittest.TestCase):
    def setUp(self):
        self.oppex = None
        self.client = None

    def tearDown(self):
        if self.client is not None:
            self.client.close()
        if self.oppex is not None:
            self.oppex.close()

    def _start(self, responses=None, service_key="client-key"):
        self.oppex = support.FakeOppex(responses or [_OK])
        self.client = IncidentClient(api_key="api-key", service_key=service_key,
                                     endpoint=self.oppex.endpoint)
        return self.client

    def test_rejects_a_missing_or_blank_api_key(self):
        self.assertRaises(ValueError, IncidentClient, None)
        self.assertRaises(ValueError, IncidentClient, "   ")
        self.assertRaises(TypeError, IncidentClient, 7)

    def test_rejects_a_blank_endpoint(self):
        self.assertRaises(ValueError, IncidentClient, "api-key", None, "  ")

    def test_treats_a_blank_service_key_as_absent(self):
        client = IncidentClient(api_key="api-key", service_key="   ")
        try:
            self.assertRaises(RuntimeError, client.post, _request())
        finally:
            client.close()

    def test_posts_with_the_client_service_key(self):
        client = self._start()
        response = client.post(_request())

        self.assertTrue(response.successful)
        self.assertEqual("inc-1", response.incident_id)
        self.assertEqual("client-key", json.loads(self.oppex.requests[0].body)["serviceKey"])
        self.assertEqual(1, client._metrics.successful)
        self.assertEqual(1, client._metrics.processed)

    def test_a_request_service_key_overrides_the_client_key(self):
        client = self._start()
        client.post(_request(service_key="request-key"))
        self.assertEqual("request-key", json.loads(self.oppex.requests[0].body)["serviceKey"])

    def test_service_routing_omits_the_service_key(self):
        client = self._start(service_key=None)
        client.post_with_service_routing(_request())
        self.assertNotIn("serviceKey", json.loads(self.oppex.requests[0].body))

    def test_service_routing_rejects_a_request_service_key(self):
        client = self._start(service_key=None)
        self.assertRaises(ValueError, client.post_with_service_routing,
                          _request(service_key="request-key"))
        self.assertRaises(ValueError, client.post_async_with_service_routing,
                          _request(service_key="request-key"))
        self.assertEqual([], self.oppex.requests)

    def test_posting_without_any_service_key_is_refused(self):
        client = self._start(service_key=None)
        self.assertRaises(RuntimeError, client.post, _request())
        self.assertRaises(RuntimeError, client.post_async, _request())
        self.assertEqual([], self.oppex.requests)

    def test_reports_a_failed_delivery(self):
        client = self._start([(401, '{"success":false,"message":"unauthorized"}', False)])
        try:
            client.post(_request())
            self.fail("Expected an IncidentException")
        except IncidentException as failure:
            self.assertEqual(401, failure.status_code)
            self.assertFalse(failure.retryable)
        self.assertEqual(1, client._metrics.failed)
        self.assertEqual(0, client._metrics.successful)

    def test_retries_a_retryable_status_before_succeeding(self):
        client = self._start([(503, '{"success":false,"message":"busy"}', False), _OK])
        self.assertTrue(client.post(_request()).successful)
        self.assertEqual(2, len(self.oppex.requests))
        self.assertEqual(1, client._metrics.retried)

    def test_posts_asynchronously(self):
        client = self._start()
        client.post_async(_request())
        recorded = self.oppex.wait_for_requests(1)
        self.assertEqual(1, len(recorded))
        self.assertEqual("client-key", json.loads(recorded[0].body)["serviceKey"])

    def test_posts_asynchronously_with_service_routing(self):
        client = self._start(service_key=None)
        client.post_async_with_service_routing(_request())
        recorded = self.oppex.wait_for_requests(1)
        self.assertEqual(1, len(recorded))
        self.assertNotIn("serviceKey", json.loads(recorded[0].body))

    def test_an_async_failure_does_not_escape(self):
        client = self._start([(401, '{"success":false,"message":"unauthorized"}', False)])
        client.post_async(_request())
        self.oppex.wait_for_requests(1)
        client.close()
        self.assertEqual(1, client._metrics.failed)

    def test_rejects_a_value_that_is_not_a_request(self):
        client = self._start()
        for method in (client.post, client.post_async,
                       client.post_with_service_routing,
                       client.post_async_with_service_routing):
            self.assertRaises(TypeError, method, None)
            self.assertRaises(TypeError, method, {"title": "t"})

    def test_a_closed_client_refuses_further_posts(self):
        client = self._start()
        client.close()

        self.assertTrue(client.closed)
        self.assertRaises(IncidentException, client.post, _request())
        self.assertRaises(IncidentException, client.post_with_service_routing, _request())
        self.assertRaises(RuntimeError, client.post_async, _request())
        self.assertRaises(RuntimeError, client.post_async_with_service_routing, _request())

    def test_close_is_idempotent(self):
        client = self._start()
        client.close()
        client.close()

    def test_works_as_a_context_manager(self):
        self.oppex = support.FakeOppex([_OK])
        with IncidentClient(api_key="api-key", service_key="client-key",
                            endpoint=self.oppex.endpoint) as client:
            self.assertTrue(client.post(_request()).successful)
        self.assertTrue(client.closed)

    def test_defaults_to_the_production_endpoint(self):
        from oppex_sdk import DEFAULT_ENDPOINT

        self.assertEqual("https://api.oppex.ai/api/v1/incident/post", DEFAULT_ENDPOINT)


if __name__ == "__main__":
    unittest.main()
