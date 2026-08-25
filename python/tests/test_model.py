"""Validation and severity mapping."""

from __future__ import absolute_import

import time
import unittest

from oppex_sdk.model import IncidentRequest, IncidentResponse, Severity


class SeverityTest(unittest.TestCase):
    def test_maps_every_documented_value(self):
        self.assertEqual(1, Severity.LOWEST.value)
        self.assertEqual(2, Severity.LOW.value)
        self.assertEqual(3, Severity.MEDIUM.value)
        self.assertEqual(4, Severity.HIGH.value)
        self.assertEqual(5, Severity.CRITICAL.value)

    def test_from_value_round_trips(self):
        for severity in Severity.values():
            self.assertIs(severity, Severity.from_value(severity.value))

    def test_rejects_values_outside_the_scale(self):
        for value in (0, 6, -1):
            self.assertRaises(ValueError, Severity.from_value, value)

    def test_rejects_non_integer_values(self):
        self.assertRaises(TypeError, Severity.from_value, "3")
        self.assertRaises(TypeError, Severity.from_value, True)

    def test_names_and_repr_are_stable(self):
        self.assertEqual("MEDIUM", Severity.MEDIUM.name)
        self.assertEqual("Severity.MEDIUM", repr(Severity.MEDIUM))

    def test_equality_and_hashing(self):
        self.assertEqual(Severity.HIGH, Severity.from_value(4))
        self.assertNotEqual(Severity.HIGH, Severity.LOW)
        self.assertEqual(1, len(set([Severity.HIGH, Severity.from_value(4)])))


class IncidentRequestTest(unittest.TestCase):
    def _request(self, **overrides):
        arguments = {"title": "title", "source": "source", "severity": Severity.MEDIUM}
        arguments.update(overrides)
        return IncidentRequest(**arguments)

    def test_builds_with_defaults(self):
        before = int(time.time() * 1000)
        request = self._request()
        self.assertEqual("title", request.title)
        self.assertEqual("source", request.source)
        self.assertIs(Severity.MEDIUM, request.severity)
        self.assertEqual(1, request.priority)
        self.assertTrue(request.src_timestamp >= before)
        self.assertIsNone(request.service_key)
        self.assertIsNone(request.component)
        self.assertIsNone(request.group)
        self.assertIsNone(request.type)
        self.assertIsNone(request.details)

    def test_accepts_a_numeric_severity(self):
        self.assertIs(Severity.CRITICAL, self._request(severity=5).severity)

    def test_rejects_a_missing_severity(self):
        self.assertRaises(ValueError, self._request, severity=None)

    def test_rejects_a_blank_title(self):
        self.assertRaises(ValueError, self._request, title="   ")

    def test_rejects_a_missing_title(self):
        self.assertRaises(ValueError, self._request, title=None)

    def test_rejects_a_non_string_title(self):
        self.assertRaises(TypeError, self._request, title=7)

    def test_rejects_a_blank_source(self):
        self.assertRaises(ValueError, self._request, source="")

    def test_rejects_an_oversized_source(self):
        self.assertRaises(ValueError, self._request, source="s" * 256)
        self.assertEqual(255, len(self._request(source="s" * 255).source))

    def test_rejects_a_priority_outside_the_scale(self):
        self.assertRaises(ValueError, self._request, priority=0)
        self.assertRaises(ValueError, self._request, priority=6)

    def test_rejects_a_non_integer_priority(self):
        self.assertRaises(TypeError, self._request, priority="1")

    def test_rejects_blank_optional_fields(self):
        for field in ("service_key", "component", "group", "type", "details"):
            self.assertRaises(ValueError, self._request, **{field: " "})

    def test_rejects_a_non_positive_timestamp(self):
        self.assertRaises(ValueError, self._request, src_timestamp=0)
        self.assertRaises(ValueError, self._request, src_timestamp=-1)

    def test_accepts_a_float_timestamp_in_milliseconds(self):
        self.assertEqual(1700000000123, self._request(src_timestamp=1700000000123.9).src_timestamp)

    def test_rejects_a_non_numeric_timestamp(self):
        self.assertRaises(TypeError, self._request, src_timestamp="1700000000000")

    def test_is_immutable(self):
        request = self._request()
        self.assertRaises(AttributeError, setattr, request, "title", "other")


class IncidentResponseTest(unittest.TestCase):
    def test_exposes_every_field(self):
        response = IncidentResponse(True, 201, "created", "inc-1")
        self.assertTrue(response.successful)
        self.assertEqual(201, response.code)
        self.assertEqual("created", response.message)
        self.assertEqual("inc-1", response.incident_id)

    def test_is_immutable(self):
        response = IncidentResponse(True, 200, None, None)
        self.assertRaises(AttributeError, setattr, response, "code", 500)


if __name__ == "__main__":
    unittest.main()
