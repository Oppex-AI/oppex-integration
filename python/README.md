# Oppex Python SDK

The Oppex Python SDK posts incidents to the Oppex REST API without exposing HTTP details to applications. It is framework-agnostic, thread-safe, dependency-free, and designed for one client instance per application.

It is the Python peer of the [Java SDK](../java/README.md). Both speak the same incident contract; each presents an API that is natural for its language.

## Requirements

- CPython 2.7.9 or newer, or CPython 3.5 or newer
- No third-party runtime dependencies. The SDK uses only the standard library, so `pip install` never pulls a transitive package into an application
- No dependency on Django, Flask, FastAPI, Celery, or any other framework
- No test dependencies. The suite uses `unittest` from the standard library

There is deliberately no `requirements.txt`: nothing is needed to install, run, or test this package. Dependencies are declared where a library declares them, in `setup.py`, and `install_requires` is empty. The only pinned tooling is in [`requirements-build.txt`](requirements-build.txt), which `scripts/build-canonical.sh` uses to build the artifacts.

One universal `py2.py3-none-any` wheel serves every supported interpreter.

### Interpreter support

| Interpreter | Role in the build | Notes |
| --- | --- | --- |
| Python 2.7 | Builds the canonical artifacts and runs the tests | 2.7.9 is the floor: earlier builds cannot verify TLS certificates or send SNI. CI builds here so the published bytes are proven on the oldest supported interpreter. |
| Python 3.5 | Runs the canonical wheel | Oldest supported Python 3. |
| Python 3.8 | Runs the canonical wheel | |
| Python 3.11 | Runs the canonical wheel | |
| Python 3.13 | Runs the canonical wheel | |
| Python 3.14 | Runs the canonical wheel | Newest interpreter in the matrix. |

CI runs every entry in a pinned `python:<version>-slim` container, so no job depends on which interpreters a GitHub runner image happens to ship.

## Install

```shell
pip install oppex-integration-sdk
```

To install from a local checkout:

```shell
cd python
pip install .
```

## Usage

```python
from oppex_sdk import IncidentClient, IncidentRequest, Severity

with IncidentClient(api_key="api-key", service_key="service-key") as client:
    response = client.post(IncidentRequest(
        title="Checkout latency breached SLO",
        source="checkout-api",
        severity=Severity.HIGH,
        component="payments",
        details='{"p99_ms": 1820}',
    ))
    print(response.incident_id)
```

Create the client once, share it across threads, and close it during application shutdown. A context manager is the simplest way to guarantee that; `client.close()` works the same way when the client outlives a single block.

### Fire and forget

`post_async` queues the incident and returns immediately, so a hot code path never waits on Oppex:

```python
client.post_async(IncidentRequest(
    title="Payment gateway timeout",
    source="payments-worker",
    severity=Severity.CRITICAL,
))
```

Asynchronous delivery is best effort. The queue is bounded; under sustained overload the oldest queued incident is dropped so the newest one still has a chance, and drops are reported at most once a minute.

### Service routing

`service_key` is optional. A client built with only `api_key` posts with `post_with_service_routing`, which omits the service key so the API resolves the target service from the incident itself:

```python
with IncidentClient(api_key="api-key") as client:
    client.post_with_service_routing(IncidentRequest(
        title="Disk pressure on node-7",
        source="node-agent",
        severity=Severity.MEDIUM,
    ))
```

A request may also carry its own `service_key`, which overrides the key configured on the client. Service routing refuses such a request rather than silently ignoring the key.

## Public API

Everything importable from `oppex_sdk` is supported. `oppex_sdk._internal` and any other underscore-prefixed name is an implementation detail and may change in any release.

### `IncidentClient(api_key, service_key=None, endpoint=None)`

| Method | Behaviour |
| --- | --- |
| `post(request)` | Posts on the calling thread, including retry delays. Returns `IncidentResponse`, raises `IncidentException`. |
| `post_with_service_routing(request)` | Same, with the service key omitted so Oppex resolves the service. |
| `post_async(request)` | Queues a best-effort delivery and returns immediately. |
| `post_async_with_service_routing(request)` | Queues a best-effort service-routed delivery. |
| `close()` | Drains queued work for up to 10 seconds and releases all resources. Idempotent. |
| `closed` | Whether the client has been closed. |

`endpoint` overrides the production URL for a private deployment or a test double; leave it unset otherwise.

### `IncidentRequest(...)`

| Argument | Required | Wire field | Notes |
| --- | --- | --- | --- |
| `title` | yes | `title` | Non-blank. |
| `source` | yes | `source` | Non-blank, at most 255 characters. |
| `severity` | yes | `severity` | A `Severity` member or an integer from 1 through 5. |
| `priority` | no (`1`) | `priority` | Integer from 1 through 5. |
| `src_timestamp` | no (now) | `srcTimestamp` | Milliseconds since the Unix epoch; must be greater than zero. |
| `service_key` | no | `serviceKey` | Overrides the client's service key. |
| `component` | no | `component` | |
| `group` | no | `group` | |
| `type` | no | `type` | |
| `details` | no | `detailsJSON` | JSON **text**; callers serialize their own payload with `json.dumps`. |

Optional string arguments accept `None` for "absent" but reject a blank string, which is almost always a bug at the call site. Every argument is validated in the constructor, so a malformed incident fails before any network call.

### `Severity`

`Severity.LOWEST` (1), `Severity.LOW` (2), `Severity.MEDIUM` (3), `Severity.HIGH` (4), `Severity.CRITICAL` (5), plus `Severity.from_value(int)` and `Severity.values()`.

### `IncidentResponse`

`successful`, `code`, `message`, `incident_id`.

### `IncidentException`

`status_code` (`-1` when no HTTP response was received), `retryable`, and `cause`. The SDK has already exhausted its own retries by the time this reaches a caller.

### Errors by kind

| Situation | Raised |
| --- | --- |
| Invalid argument value | `ValueError` |
| Argument of the wrong type | `TypeError` |
| Posting with no service key anywhere; posting asynchronously on a closed client | `RuntimeError` |
| Delivery failed, or posting synchronously on a closed client | `IncidentException` |

## Delivery semantics

- **Endpoint**: `POST https://api.oppex.ai/api/v1/incident/post`, authenticated with the `X-API-KEY` header.
- **Timeouts**: 3 seconds to connect, 5 seconds per socket operation.
- **Retries**: HTTP 429, 500, 502, 503 and 504, plus failures that never reached a status line, are retried with a 0.5s, 1s, 2s, 4s, 8s backoff. Every other status fails immediately.
- **Connections**: keep-alive connections are pooled, up to 20 idle. A burst opens extra connections rather than blocking for a permit.
- **Concurrency**: two daemon worker threads drain a queue bounded at 5000 incidents.
- **Shutdown**: `close()` stops admitting posts, drains in-flight and queued work for up to 10 seconds, then abandons what is left rather than delaying the process.

## Build and test

The test suite uses only `unittest` and never leaves loopback, so there is nothing to install first:

```shell
cd python
PYTHONPATH=src python -m unittest discover -s tests -t .
```

### Building

`setup.py` imports `setuptools`, which is a build-time requirement and the reason `pip install .` or `./scripts/build-canonical.sh` can fail with `No module named 'setuptools'`. Python 3.12 and newer no longer seed it into a new virtual environment, so install the pinned build tooling first:

```shell
cd python
python -m pip install --requirement requirements-build.txt
```

Nothing in `src/oppex_sdk/` imports `setuptools`, which is why the published wheel declares no dependencies.

Build the canonical artifacts the same way CI does, on Python 2.7:

```shell
./scripts/build-canonical.sh
```

The outputs are `dist/oppex_integration_sdk-<version>-py2.py3-none-any.whl` and a matching `.tar.gz` sdist.

The same script works on Python 3 and produces the same wheel contents, which is the practical local path when no Python 2.7 interpreter is installed. It prints a note when it runs there, because only a 2.7 build byte-compiles the tree at the interpreter floor the wheel claims. Use a Python 3 build for local testing; let CI produce the artifact that gets released.

`requirements-build.txt` carries an upper bound on both tools: `setuptools` 70 and `wheel` 0.45 dropped support for the universal `py2.py3-none-any` wheel this SDK publishes as one artifact.

Verify a built wheel on the interpreter of your choice:

```shell
python/scripts/verify-runtime.sh python/dist/oppex_integration_sdk-*-py2.py3-none-any.whl
```

That script installs the wheel, byte-compiles the installed package, runs the full suite against the installed bytes, and runs the external consumer at `.github/smoke/python/external_consumer.py`.

To sweep several locally installed interpreters at once:

```shell
cd python
tox
```

`tox` is a convenience only. `.github/workflows/python-compatibility.yml` is authoritative, and `tox 4` cannot create a Python 2.7 environment; use `tox<4` with `virtualenv<20.22` for that.

## Examples

- [`examples/plain_python.py`](examples/plain_python.py): a script that owns one client for its lifetime.
- [`examples/flask_app.py`](examples/flask_app.py): an application-scoped client in Flask.
- [`examples/django_apps.py`](examples/django_apps.py): an `AppConfig` that owns the client for the process.
- [`examples/compatibility_smoke.py`](examples/compatibility_smoke.py): a network-free check that an interpreter can run the SDK.

## Release

Releases are cut from a `python-v<major>.<minor>.<patch>` tag, independently of the Java SDK's `java-v*` tags. The tag rewrites the version, the compatibility workflow builds and proves the canonical artifacts, and `python-publish.yml` uploads those exact bytes to PyPI without rebuilding them.

## Differences from the Java SDK

The wire contract, retry classification, timeouts, queue behaviour, and shutdown guarantees are the same. The surfaces differ where the languages do:

| Java | Python | Why |
| --- | --- | --- |
| `IncidentClient.builder().apiKey(...).build()` | `IncidentClient(api_key=...)` | Keyword arguments already give the builder's readability. |
| `IncidentRequest.builder()...build()` | `IncidentRequest(...)` | Same. |
| `Closeable` plus try/finally | `close()` plus context manager | |
| `IllegalArgumentException` / `IllegalStateException` | `ValueError`, `TypeError`, `RuntimeError` | |
| Apache HttpClient and Jackson are bundled | Standard library `http.client` and `json` | Python ships both, so the SDK stays dependency-free. |
| Pool blocks when all 20 permits are in use | Pool opens an extra connection instead of blocking | `http.client` has no permit model, and blocking an incident path is worse than an extra socket. |
| `shutdownNow()` interrupts retry backoff | A shutdown event cuts the backoff short | Python threads cannot be interrupted. |
| No `User-Agent` beyond Apache HttpClient's default | `oppex-integration-sdk-python/<version>` | `http.client` sends none by default. |

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
