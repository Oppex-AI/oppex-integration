"""Oppex integration SDK for Python.

Posts incidents to the Oppex REST API from Python 2.7 and Python 3 applications
using only the standard library.
"""

from __future__ import absolute_import

import logging

from oppex_sdk._version import __version__
from oppex_sdk.client import DEFAULT_ENDPOINT, IncidentClient
from oppex_sdk.exceptions import IncidentException
from oppex_sdk.model import IncidentRequest, IncidentResponse, Severity

__all__ = [
    "DEFAULT_ENDPOINT",
    "IncidentClient",
    "IncidentException",
    "IncidentRequest",
    "IncidentResponse",
    "Severity",
    "__version__",
]

# A library must not configure logging for its host application.
logging.getLogger(__name__).addHandler(logging.NullHandler())
