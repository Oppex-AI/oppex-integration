"""Wire format produced and consumed by the SDK."""

from __future__ import absolute_import

import json
import unittest

from oppex_sdk._internal.json_codec import JsonCodec
from oppex_sdk.exceptions import IncidentException
from oppex_sdk.model import IncidentRequest, Severity


class SerializeTest(unittest.TestCase):
    def setUp(self):
        self.codec = JsonCodec()

    def test_writes_every_documented_field(self):
        request = IncidentRequest(
            title="Checkout latency",
            source="checkout-api",
            severity=Severity.HIGH,
            priority=2,
            src_timestamp=1700000000000,
            component="payments",
            group="platform",
            type="latency",
            details='{"p99":1820}',
        )
        payload = json.loads(self.codec.serialize(request, "client-key"))
        self.assertEqual({
            "serviceKey": "client-key",
            "title": "Checkout latency",
            "source": "checkout-api",
            "severity": 4,
            "priority": 2,
            "srcTimestamp": 1700000000000,
            "component": "payments",
            "group": "platform",
            "type": "latency",
            "detailsJSON": '{"p99":1820}',
        }, payload)

    def test_omits_absent_optional_fields(self):
        request = IncidentRequest(title="t", source="s", severity=Severity.LOW,
                                  src_timestamp=1700000000000)
        payload = json.loads(self.codec.serialize(request, "client-key"))
        self.assertEqual(
            ["priority", "serviceKey", "severity", "source", "srcTimestamp", "title"],
            sorted(payload.keys()),
        )

    def test_request_service_key_overrides_the_client_key(self):
        request = IncidentRequest(title="t", source="s", severity=Severity.LOW,
                                  service_key="request-key")
        payload = json.loads(self.codec.serialize(request, "client-key"))
        self.assertEqual("request-key", payload["serviceKey"])

    def test_omits_the_service_key_when_none_is_resolved(self):
        request = IncidentRequest(title="t", source="s", severity=Severity.LOW)
        payload = json.loads(self.codec.serialize(request, None))
        self.assertNotIn("serviceKey", payload)

    def test_field_order_matches_the_documented_contract(self):
        request = IncidentRequest(title="t", source="s", severity=Severity.LOW,
                                  src_timestamp=1700000000000, component="c",
                                  group="g", type="ty", details="{}")
        text = self.codec.serialize(request, "client-key")
        self.assertEqual(
            '{"serviceKey":"client-key","title":"t","source":"s","severity":2,'
            '"priority":1,"srcTimestamp":1700000000000,"component":"c",'
            '"group":"g","type":"ty","detailsJSON":"{}"}',
            text,
        )

    def test_serializes_non_ascii_text(self):
        request = IncidentRequest(title=u"café down", source="s", severity=Severity.LOW)
        payload = json.loads(self.codec.serialize(request, None))
        self.assertEqual(u"café down", payload["title"])


class ParseResponseTest(unittest.TestCase):
    def setUp(self):
        self.codec = JsonCodec()

    def test_reads_every_documented_field(self):
        response = self.codec.parse_response(
            '{"success":true,"code":201,"message":"created","data":"inc-9"}', 200)
        self.assertTrue(response.successful)
        self.assertEqual(201, response.code)
        self.assertEqual("created", response.message)
        self.assertEqual("inc-9", response.incident_id)

    def test_falls_back_to_the_http_status(self):
        response = self.codec.parse_response("{}", 202)
        self.assertTrue(response.successful)
        self.assertEqual(202, response.code)
        self.assertIsNone(response.message)
        self.assertIsNone(response.incident_id)

    def test_treats_an_empty_body_as_the_http_outcome(self):
        for body in (None, "", "   "):
            self.assertTrue(self.codec.parse_response(body, 200).successful)
            self.assertFalse(self.codec.parse_response(body, 500).successful)

    def test_body_success_flag_overrides_the_http_status(self):
        self.assertFalse(self.codec.parse_response('{"success":false}', 200).successful)

    def test_skips_nested_and_unexpected_values(self):
        response = self.codec.parse_response(
            '{"errors":[{"field":"title"}],"meta":{"trace":"abc"},"code":422}', 422)
        self.assertFalse(response.successful)
        self.assertEqual(422, response.code)

    def test_rejects_a_malformed_body(self):
        self.assertRaises(IncidentException, self.codec.parse_response, "not json", 200)

    def test_rejects_a_json_value_that_is_not_an_object(self):
        self.assertRaises(IncidentException, self.codec.parse_response, "[1,2]", 200)


if __name__ == "__main__":
    unittest.main()
