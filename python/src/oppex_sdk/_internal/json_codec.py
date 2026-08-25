"""Internal JSON wire codec. Not part of the supported SDK API."""

from __future__ import absolute_import

import json
from collections import OrderedDict

from oppex_sdk._compat import integer_types, string_types
from oppex_sdk.exceptions import IncidentException
from oppex_sdk.model import IncidentResponse

_MALFORMED = "Oppex returned a malformed JSON response"


class JsonCodec(object):
    """Serializes requests and parses responses using the documented wire fields."""

    def serialize(self, request, default_service_key):
        """Returns the request as JSON text.

        A resolved service key of ``None`` is omitted so the API routes the
        incident by its own rules.
        """
        service_key = request.service_key
        if service_key is None:
            service_key = default_service_key

        payload = OrderedDict()
        _put_optional(payload, "serviceKey", service_key)
        payload["title"] = request.title
        payload["source"] = request.source
        payload["severity"] = request.severity.value
        payload["priority"] = request.priority
        payload["srcTimestamp"] = request.src_timestamp
        _put_optional(payload, "component", request.component)
        _put_optional(payload, "group", request.group)
        _put_optional(payload, "type", request.type)
        _put_optional(payload, "detailsJSON", request.details)
        return json.dumps(payload, separators=(",", ":"))

    def parse_response(self, body, http_status):
        """Parses a response body, falling back to the HTTP status for missing fields.

        Raises ``IncidentException`` when the body is present but is not a JSON object.
        """
        successful = 200 <= http_status < 300
        if body is None or not body.strip():
            return IncidentResponse(successful, http_status, None, None)

        try:
            payload = json.loads(body)
        except ValueError as malformed:
            raise IncidentException(_MALFORMED, cause=malformed)
        if not isinstance(payload, dict):
            raise IncidentException(_MALFORMED)

        if payload.get("success") is True:
            successful = True
        elif payload.get("success") is False:
            successful = False
        return IncidentResponse(
            successful,
            _int_or(payload.get("code"), http_status),
            _text_or_none(payload.get("message")),
            _text_or_none(payload.get("data")),
        )


def _put_optional(payload, name, value):
    if value is not None:
        payload[name] = value


def _int_or(value, fallback):
    if isinstance(value, bool) or not isinstance(value, integer_types + (float,)):
        return fallback
    return int(value)


def _text_or_none(value):
    if isinstance(value, string_types):
        return value
    return None
