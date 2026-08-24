"""Boundary validation shared by the public model and client types."""

from __future__ import absolute_import

from oppex_sdk._compat import integer_types, string_types, to_text


def require_text(value, name):
    """Returns ``value`` as text, rejecting ``None``, blanks and non-strings."""
    if value is None:
        raise ValueError(name + " must not be None")
    return _as_non_blank_text(value, name)


def optional_text(value, name):
    """Returns ``value`` as text, or ``None``. A blank value is rejected."""
    if value is None:
        return None
    return _as_non_blank_text(value, name)


def blank_to_none(value, name):
    """Returns ``value`` as text, treating ``None`` and blanks alike as absent."""
    if value is None:
        return None
    text = _as_text(value, name)
    if not text.strip():
        return None
    return text


def require_int_in_range(value, name, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, integer_types):
        raise TypeError(name + " must be an integer")
    if value < minimum or value > maximum:
        raise ValueError("%s must be between %d and %d" % (name, minimum, maximum))
    return int(value)


def _as_non_blank_text(value, name):
    text = _as_text(value, name)
    if not text.strip():
        raise ValueError(name + " must not be blank")
    return text


def _as_text(value, name):
    if not isinstance(value, string_types):
        raise TypeError(name + " must be a string")
    try:
        return to_text(value)
    except UnicodeDecodeError:
        raise ValueError(name + " must be valid UTF-8 text")
