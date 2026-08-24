"""Byte-compiled and executed by each CI interpreter to verify the consumer API.

This file may use only the supported SDK API and Python 2.7-compatible syntax.
"""

from __future__ import absolute_import, print_function

import sys

from oppex_sdk import IncidentClient, IncidentRequest, Severity


def main():
    with IncidentClient(api_key="external-consumer-api-key",
                        service_key="external-consumer-service-key") as client:
        request = IncidentRequest(
            title="External consumer compatibility test",
            source="github-actions",
            severity=Severity.MEDIUM,
        )
        if request.severity.value != 3:
            raise AssertionError("Unexpected severity mapping")
        if client.closed:
            raise AssertionError("A new client must not be closed")

    # Service routing needs no service key, and its precondition fails before any network call.
    with IncidentClient(api_key="external-consumer-api-key") as routing_client:
        keyed = IncidentRequest(
            title="Service routing compatibility test",
            source="github-actions",
            severity=Severity.LOW,
            service_key="external-consumer-service-key",
        )
        try:
            routing_client.post_with_service_routing(keyed)
        except ValueError:
            pass  # Service routing must refuse a request that carries its own service key.
        else:
            raise AssertionError("Expected a request service key to be rejected")

    print("EXTERNAL_CONSUMER_OK python=" + sys.version.split()[0])
    return 0


if __name__ == "__main__":
    sys.exit(main())
