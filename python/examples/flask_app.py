"""Flask integration: the client is application-scoped, not request-scoped.

Creating a client per request would rebuild the connection pool and worker
threads on every call.
"""

from __future__ import absolute_import

import atexit
import os

from oppex_sdk import IncidentClient, IncidentRequest, Severity


def create_app():
    from flask import Flask

    app = Flask(__name__)
    client = IncidentClient(
        api_key=os.environ["OPPEX_API_KEY"],
        service_key=os.environ.get("OPPEX_SERVICE_KEY"),
    )
    atexit.register(client.close)

    @app.route("/checkout", methods=["POST"])
    def checkout():
        try:
            return handle_checkout()
        except Exception as failure:
            client.post_async(IncidentRequest(
                title="Checkout request failed",
                source="checkout-api",
                severity=Severity.HIGH,
                component="checkout",
                details='{"error":"%s"}' % type(failure).__name__,
            ))
            raise

    return app


def handle_checkout():
    return {"status": "ok"}
