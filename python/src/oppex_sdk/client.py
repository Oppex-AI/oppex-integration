"""Thread-safe client for posting incidents to Oppex."""

from __future__ import absolute_import

import logging
import threading

from oppex_sdk._internal.dispatcher import AsyncDispatcher
from oppex_sdk._internal.http_executor import HttpExecutor
from oppex_sdk._internal.lifecycle import Lifecycle
from oppex_sdk._internal.metrics import InternalMetrics
from oppex_sdk._internal.retry import RetryExecutor
from oppex_sdk._validation import blank_to_none, require_text
from oppex_sdk.exceptions import IncidentException
from oppex_sdk.model import IncidentRequest

LOGGER = logging.getLogger(__name__)

DEFAULT_ENDPOINT = "https://api.oppex.ai/api/v1/incident/post"

_CLOSED_MESSAGE = "IncidentClient is closed"
_NO_SERVICE_KEY_MESSAGE = (
    "No service_key is configured on the client or the request; "
    "supply one or use post_with_service_routing"
)


class IncidentClient(object):
    """Posts incidents to Oppex without exposing any HTTP detail.

    Create one client per application, share it across threads, and close it
    during application shutdown, either explicitly or as a context manager::

        with IncidentClient(api_key="...", service_key="...") as client:
            client.post_async(IncidentRequest(
                title="Checkout latency breached SLO",
                source="checkout-api",
                severity=Severity.HIGH,
            ))

    ``service_key`` is optional. A client built with only ``api_key`` posts with
    :meth:`post_with_service_routing`, which omits the service key so the API
    resolves the target service itself.
    """

    def __init__(self, api_key, service_key=None, endpoint=None):
        """Creates a client.

        ``endpoint`` overrides the production URL and exists for private
        deployments and tests; leave it unset otherwise.
        """
        api_key = require_text(api_key, "api_key")
        endpoint = require_text(DEFAULT_ENDPOINT if endpoint is None else endpoint, "endpoint")

        self._service_key = blank_to_none(service_key, "service_key")
        self._metrics = InternalMetrics()
        self._shutdown_signal = threading.Event()
        self._http_executor = HttpExecutor(api_key, endpoint)
        self._retry_executor = RetryExecutor(
            self._metrics, sleeper=_InterruptibleSleeper(self._shutdown_signal)
        )
        self._dispatcher = AsyncDispatcher(self._metrics, shutdown_signal=self._shutdown_signal)
        self._lifecycle = Lifecycle()

    def post(self, request):
        """Posts on the calling thread, including any retry delays.

        Returns an ``IncidentResponse`` or raises ``IncidentException``.
        """
        self._require_request(request)
        self._require_service_key(request)
        return self._post(request, self._service_key)

    def post_with_service_routing(self, request):
        """Posts without a service key so Oppex resolves the target service.

        The request must not carry its own service key. Otherwise identical to
        :meth:`post`: it runs and retries on the calling thread.
        """
        self._require_request(request)
        self._require_service_routable(request)
        return self._post(request, None)

    def post_async(self, request):
        """Queues a best-effort delivery and returns immediately."""
        self._require_request(request)
        self._require_service_key(request)
        self._submit(request, self._service_key)

    def post_async_with_service_routing(self, request):
        """Queues a best-effort service-routed delivery and returns immediately.

        The request must not carry its own service key.
        """
        self._require_request(request)
        self._require_service_routable(request)
        self._submit(request, None)

    def close(self):
        """Drains queued work for a bounded period and releases all resources.

        Closing twice is a no-op, and a closed client refuses further posts.
        """
        if not self._lifecycle.begin_close():
            return
        self._dispatcher.close()
        try:
            self._http_executor.close()
        except Exception:
            LOGGER.debug("Failed to close Oppex HTTP resources", exc_info=True)

    @property
    def closed(self):
        return self._lifecycle.closed

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()
        return False

    def _post(self, request, default_service_key):
        if not self._lifecycle.begin():
            raise IncidentException(_CLOSED_MESSAGE)
        try:
            return self._deliver(request, default_service_key)
        finally:
            self._lifecycle.end()

    def _submit(self, request, default_service_key):
        if self._lifecycle.closed:
            raise RuntimeError(_CLOSED_MESSAGE)

        def delivery():
            # Asynchronous posting is best effort, so a failure is reported only in logs.
            try:
                self._deliver(request, default_service_key)
            except IncidentException as failure:
                LOGGER.debug("Asynchronous incident delivery failed: %s", failure)

        self._dispatcher.submit(delivery)

    def _deliver(self, request, default_service_key):
        try:
            response = self._retry_executor.execute(
                lambda: self._http_executor.execute(request, default_service_key)
            )
            self._metrics.increment_successful()
            return response
        except IncidentException:
            self._metrics.increment_failed()
            raise
        finally:
            self._metrics.increment_processed()

    def _require_service_key(self, request):
        """Service routing is the only mode available with no service key anywhere."""
        if self._service_key is None and request.service_key is None:
            raise RuntimeError(_NO_SERVICE_KEY_MESSAGE)

    @staticmethod
    def _require_service_routable(request):
        if request.service_key is not None:
            raise ValueError("request must not carry a service_key when service routing is used")

    @staticmethod
    def _require_request(request):
        if not isinstance(request, IncidentRequest):
            raise TypeError("request must be an IncidentRequest")


class _InterruptibleSleeper(object):
    """Sleeps until the delay elapses or the client starts a forced shutdown."""

    def __init__(self, shutdown_signal):
        self._shutdown_signal = shutdown_signal

    def __call__(self, seconds):
        return self._shutdown_signal.wait(seconds)
