"""Exercises the supported API without touching the network.

Used as a quick local check that an interpreter can run the SDK; CI runs the
equivalent consumer at .github/smoke/python/external_consumer.py.
"""

from __future__ import absolute_import, print_function

import platform
import sys

from oppex_sdk import IncidentClient, IncidentRequest, Severity, __version__


def main():
    print("sdk=%s python=%s implementation=%s" % (
        __version__, sys.version.split()[0], platform.python_implementation()))

    for severity in Severity.values():
        print("severity %s=%d" % (severity.name, severity.value))

    with IncidentClient(api_key="compatibility-smoke") as client:
        request = IncidentRequest(
            title="Compatibility smoke",
            source="compatibility-smoke",
            severity=Severity.LOWEST,
            src_timestamp=1700000000000,
        )
        print("request=%r" % (request,))
        try:
            client.post(request)
        except RuntimeError as expected:
            print("no service key configured: %s" % expected)
    return 0


if __name__ == "__main__":
    sys.exit(main())
