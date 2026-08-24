"""Python 2.7 and Python 3 compatibility helpers.

The SDK supports a single source tree that runs unmodified on CPython 2.7.9+
and 3.5+, so every version-dependent import is resolved here instead of being
repeated across modules.
"""

from __future__ import absolute_import

import sys
import time

PY2 = sys.version_info[0] == 2

try:  # Python 3
    import http.client as http_client
except ImportError:  # Python 2
    import httplib as http_client  # noqa: F401

try:  # Python 3
    from urllib.parse import urlsplit
except ImportError:  # Python 2
    from urlparse import urlsplit  # noqa: F401

try:  # Python 3
    import queue as queue_module
except ImportError:  # Python 2
    import Queue as queue_module  # noqa: F401

if PY2:
    string_types = (str, unicode)  # noqa: F821 - unicode only exists on Python 2
    text_type = unicode  # noqa: F821
    integer_types = (int, long)  # noqa: F821
else:
    string_types = (str,)
    text_type = str
    integer_types = (int,)

# Python 2 has no monotonic clock. Wall time is only used for shutdown deadlines,
# where a clock adjustment shortens or lengthens a bounded wait but cannot corrupt state.
monotonic = getattr(time, "monotonic", time.time)


def to_text(value):
    """Returns ``value`` as the interpreter's text type, decoding bytes as UTF-8."""
    if isinstance(value, text_type):
        return value
    return value.decode("utf-8")


def to_native_str(value):
    """Returns ``value`` as the interpreter's native ``str``, for HTTP header use."""
    if isinstance(value, str):
        return value
    if PY2:
        return value.encode("utf-8")
    return value.decode("utf-8")
