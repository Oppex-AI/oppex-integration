"""Minimal application that owns one client for its whole lifetime."""

from __future__ import absolute_import, print_function

import os

from oppex_sdk import IncidentClient, IncidentRequest, Severity


def main():
    client = IncidentClient(
        api_key=os.environ["OPPEX_API_KEY"],
        service_key=os.environ.get("OPPEX_SERVICE_KEY"),
    )
    try:
        client.post_async(IncidentRequest(
            title="Example incident",
            source="plain-python",
            severity=Severity.LOW,
            details='{"example":true}',
        ))
    finally:
        # Closing drains queued incidents before the process exits.
        client.close()


if __name__ == "__main__":
    main()
