"""Immutable incident types exchanged with the Oppex API."""

from __future__ import absolute_import

import time

from oppex_sdk._compat import integer_types
from oppex_sdk._validation import (
    optional_text,
    require_int_in_range,
    require_text,
)

_MAX_SOURCE_LENGTH = 255
_MIN_SEVERITY = 1
_MAX_SEVERITY = 5


class Severity(object):
    """Oppex incident severity on a scale from 1 (lowest) to 5 (highest).

    The five members are created once and compared by identity. A hand-rolled
    constant class is used instead of :mod:`enum` because ``enum`` is not
    available on Python 2.7 and the SDK must present one type on every runtime.
    """

    __slots__ = ("_name", "_value")

    _BY_VALUE = {}

    def __init__(self, name, value):
        self._name = name
        self._value = value

    @property
    def name(self):
        return self._name

    @property
    def value(self):
        """Returns the numeric value sent to Oppex."""
        return self._value

    @classmethod
    def from_value(cls, value):
        """Returns the severity for an Oppex numeric value.

        Raises ``ValueError`` when ``value`` is outside 1 through 5.
        """
        if isinstance(value, bool) or not isinstance(value, integer_types):
            raise TypeError("severity must be an integer or a Severity")
        try:
            return cls._BY_VALUE[int(value)]
        except KeyError:
            raise ValueError("severity must be between %d and %d" % (_MIN_SEVERITY, _MAX_SEVERITY))

    @classmethod
    def values(cls):
        """Returns every severity in ascending order."""
        return tuple(cls._BY_VALUE[value] for value in sorted(cls._BY_VALUE))

    @classmethod
    def coerce(cls, value):
        """Returns ``value`` as a severity, accepting a member or its numeric value."""
        if isinstance(value, cls):
            return value
        if value is None:
            raise ValueError("severity must not be None")
        return cls.from_value(value)

    def __repr__(self):
        return "Severity." + self._name

    def __str__(self):
        return self._name

    def __eq__(self, other):
        if isinstance(other, Severity):
            return self._value == other._value
        return NotImplemented

    def __ne__(self, other):
        result = self.__eq__(other)
        if result is NotImplemented:
            return result
        return not result

    def __hash__(self):
        return hash(("Severity", self._value))


Severity.LOWEST = Severity("LOWEST", 1)
Severity.LOW = Severity("LOW", 2)
Severity.MEDIUM = Severity("MEDIUM", 3)
Severity.HIGH = Severity("HIGH", 4)
Severity.CRITICAL = Severity("CRITICAL", 5)
Severity._BY_VALUE = {
    severity.value: severity
    for severity in (
        Severity.LOWEST,
        Severity.LOW,
        Severity.MEDIUM,
        Severity.HIGH,
        Severity.CRITICAL,
    )
}


class IncidentRequest(object):
    """A validated, immutable incident submission.

    Every argument is checked in the constructor so a malformed incident fails
    before any network call. A request may carry its own ``service_key``, which
    overrides the key configured on the client.
    """

    __slots__ = (
        "_service_key",
        "_title",
        "_source",
        "_severity",
        "_priority",
        "_src_timestamp",
        "_component",
        "_group",
        "_type",
        "_details",
    )

    def __init__(self, title, source, severity, priority=1, src_timestamp=None,
                 service_key=None, component=None, group=None, type=None, details=None):
        """Creates a validated incident.

        ``src_timestamp`` is milliseconds since the Unix epoch, matching the wire
        contract; it defaults to now. ``details`` is JSON *text* sent in the
        wire-level ``detailsJSON`` field, so callers serialize their own payload.
        ``type`` mirrors the API field name and shadows the builtin only inside
        this signature.
        """
        self._title = require_text(title, "title")
        self._source = require_text(source, "source")
        if len(self._source) > _MAX_SOURCE_LENGTH:
            raise ValueError("source must not exceed %d characters" % _MAX_SOURCE_LENGTH)
        self._severity = Severity.coerce(severity)
        self._priority = require_int_in_range(priority, "priority", 1, 5)
        self._src_timestamp = _resolve_src_timestamp(src_timestamp)
        self._service_key = optional_text(service_key, "service_key")
        self._component = optional_text(component, "component")
        self._group = optional_text(group, "group")
        self._type = optional_text(type, "type")
        self._details = optional_text(details, "details")

    @property
    def service_key(self):
        return self._service_key

    @property
    def title(self):
        return self._title

    @property
    def source(self):
        return self._source

    @property
    def severity(self):
        return self._severity

    @property
    def priority(self):
        return self._priority

    @property
    def src_timestamp(self):
        """Returns the incident time in milliseconds since the Unix epoch."""
        return self._src_timestamp

    @property
    def component(self):
        return self._component

    @property
    def group(self):
        return self._group

    @property
    def type(self):
        return self._type

    @property
    def details(self):
        """Returns the JSON text sent in the wire-level ``detailsJSON`` field."""
        return self._details

    def __repr__(self):
        return "IncidentRequest(title=%r, source=%r, severity=%r, priority=%r)" % (
            self._title,
            self._source,
            self._severity,
            self._priority,
        )


class IncidentResponse(object):
    """Immutable result of a synchronous incident submission."""

    __slots__ = ("_successful", "_code", "_message", "_incident_id")

    def __init__(self, successful, code, message, incident_id):
        self._successful = bool(successful)
        self._code = code
        self._message = message
        self._incident_id = incident_id

    @property
    def successful(self):
        return self._successful

    @property
    def code(self):
        return self._code

    @property
    def message(self):
        return self._message

    @property
    def incident_id(self):
        return self._incident_id

    def __repr__(self):
        return "IncidentResponse(successful=%r, code=%r, message=%r, incident_id=%r)" % (
            self._successful,
            self._code,
            self._message,
            self._incident_id,
        )


def _resolve_src_timestamp(src_timestamp):
    if src_timestamp is None:
        return int(time.time() * 1000)
    if isinstance(src_timestamp, bool) or not isinstance(src_timestamp, integer_types + (float,)):
        raise TypeError("src_timestamp must be milliseconds since the Unix epoch")
    resolved = int(src_timestamp)
    if resolved <= 0:
        raise ValueError("src_timestamp must be greater than zero")
    return resolved
