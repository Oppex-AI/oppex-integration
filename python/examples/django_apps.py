"""Django integration: one client per process, closed when the process stops.

Register this AppConfig in ``INSTALLED_APPS`` and read the client through
``OppexAppConfig.client``.
"""

from __future__ import absolute_import

import atexit
import os

from oppex_sdk import IncidentClient


class OppexAppConfig(object):
    """Mirror of ``django.apps.AppConfig`` without importing Django here.

    In a real project this subclasses ``django.apps.AppConfig``; the lifecycle
    is what matters: build the client in ``ready()``, close it at process exit.
    """

    name = "oppex_integration"
    client = None

    def ready(self):
        if OppexAppConfig.client is not None:
            return
        OppexAppConfig.client = IncidentClient(
            api_key=os.environ["OPPEX_API_KEY"],
            service_key=os.environ.get("OPPEX_SERVICE_KEY"),
        )
        atexit.register(OppexAppConfig.client.close)
