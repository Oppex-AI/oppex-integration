# Oppex Python SDK Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file is the durable engineering context for the Python SDK directory. It records why the project is structured as it is, which decisions are intentional, and how to evolve it without breaking interpreter compatibility, API stability, delivery semantics, or framework independence.

The Python SDK was written as the peer of the existing [Java SDK](../java/CLAUDE.md). The incident contract is shared; the surface is idiomatic Python. Where the two intentionally differ, the difference is listed in [section 9](#9-intentional-differences-from-the-java-sdk) and in the README, not left for a reader to discover.

## 1. Mission

The SDK gives Python applications a minimal API for posting incidents to:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

Users should not need to understand `http.client`, connection reuse, JSON serialization, retry classification, bounded queues, or shutdown coordination.

The expected client setup is:

```python
client = IncidentClient(api_key="api-key", service_key="service-key")
```

The service key is optional. A client built with only `api_key` posts with `post_with_service_routing`, which omits `serviceKey` from the payload so the API resolves the target service itself.

Create one client per application, reuse it concurrently, and close it during application shutdown.

## 2. Non-negotiable constraints

Changes must preserve all of these unless a deliberate new major-version decision is documented first:

- Source must run unmodified on CPython 2.7.9 and on current CPython 3.
- Zero third-party runtime dependencies. `install_requires` stays empty.
- Zero third-party test dependencies. Tests use `unittest` from the standard library.
- No `requirements.txt`. Nothing is required to install, run, or test the package, and an empty requirements file would imply otherwise. Build-time pins live in `requirements-build.txt`, which is the only requirements file this SDK has.
- No `pyproject.toml`. A `[build-system]` table makes pip build in an isolated environment and fetch a modern `setuptools`, which does not run on Python 2.7, so `pip install .` would stop working on the interpreter this SDK exists to support. Revisit only when 2.7 support is dropped.
- One universal `py2.py3-none-any` wheel serves every supported interpreter.
- Tests must not reach the network beyond loopback.
- No framework imports in `src/`. Framework code belongs in `examples/`.
- The published artifact is a library. It must never declare a console entry point.

### Python 2.7 syntax rules

The 2.7 floor is a syntax floor, and it is enforced by `python -m compileall` on Python 2.7 in CI, which is this SDK's equivalent of compiling the Java SDK at `-source 1.7`. Do not use:

- f-strings, walrus operator, or any annotation syntax;
- keyword-only arguments, `nonlocal`, `yield from`, `async`/`await`;
- `super()` without arguments;
- `pathlib`, `enum`, `typing`, `concurrent.futures`, `secrets`, or `time.monotonic` without a fallback;
- `str`/`bytes` assumptions. Text crosses the boundary as the interpreter's text type.

Every version-dependent import belongs in [`src/oppex_sdk/_compat.py`](src/oppex_sdk/_compat.py) so no other module carries a `try`/`ImportError` pair.

The 2.7.9 patch floor exists because earlier 2.7 builds cannot verify TLS certificates or send SNI. `_internal/http_executor.py` fails fast with that explanation rather than silently posting over an unverified connection.

## 3. Directory ownership

```text
python/
├── CLAUDE.md            # This guide
├── README.md            # User-facing documentation
├── LICENSE              # Copy of the root license, required in the sdist and wheel
├── MANIFEST.in          # sdist contents
├── setup.py             # Packaging; reads the version textually
├── setup.cfg            # Universal wheel and license metadata
├── requirements-build.txt  # Pinned build tooling; the SDK has no other requirements
├── tox.ini              # Local multi-interpreter convenience only; CI is authoritative
├── scripts/             # Build and verification entry points shared by CI and humans
├── src/oppex_sdk/       # The library
│   └── _internal/       # Implementation details, not supported API
├── tests/               # unittest suite, standard library only
└── examples/            # Framework integrations; never imported by the library
```

Everything the SDK needs to build, test, and release lives in this directory. Nothing here may require the Java toolchain, and nothing here belongs at repository root except the workflow YAML that GitHub can only discover there.

`src/` layout is deliberate: without it, `python -m unittest` from the project root would import the working tree instead of the installed package, and CI would stop testing the bytes it publishes.

## 4. Public API boundary

Supported API is exactly what [`src/oppex_sdk/__init__.py`](src/oppex_sdk/__init__.py) exports:

- `IncidentClient`
- `IncidentRequest`, `IncidentResponse`, `Severity`
- `IncidentException`
- `DEFAULT_ENDPOINT`, `__version__`

`oppex_sdk._internal` and every other underscore-prefixed name is private and may change in any release. Adding a name to `__all__` is an API commitment; treat it as one.

Public exception mapping, kept stable because callers write `except` clauses against it:

| Situation | Raised |
| --- | --- |
| Invalid argument value | `ValueError` |
| Argument of the wrong type | `TypeError` |
| No service key anywhere; asynchronous post on a closed client | `RuntimeError` |
| Delivery failure; synchronous post on a closed client | `IncidentException` |

Do not let a socket, TLS, `http.client`, or `json` exception escape a public method. `_internal/errors.TransportError` exists so the transport can report a recoverable failure without the retry policy or the caller knowing which library raised it.

## 5. Validation is a boundary concern

`IncidentRequest.__init__` and `IncidentClient.__init__` validate everything, so a malformed incident fails at the call site instead of inside a worker thread where only a log line would remain. Shared rules live in [`src/oppex_sdk/_validation.py`](src/oppex_sdk/_validation.py); do not reimplement them per module.

Two rules are easy to get wrong:

- An optional string accepts `None` for "absent" but rejects a blank string, which is nearly always a bug at the call site.
- `bool` is an `int` in Python. Numeric validation rejects `True` explicitly.

## 6. Concurrency and lifecycle

- `IncidentClient` is thread-safe and intended to be shared. It owns a connection pool, two daemon worker threads, and a retry policy.
- `post` and `post_with_service_routing` run and retry on the calling thread.
- `post_async` and `post_async_with_service_routing` queue the work and return. Asynchronous delivery is best effort; failures are logged at debug level and never propagate to the caller.
- The queue is bounded at 5000. When full, the oldest queued incident is dropped so the newest still has a chance, and submission never blocks the application.
- Drops are counted always and logged at most once a minute. A saturated queue drops continuously, so per-drop logging would replace one overload with another.
- Worker threads are daemons, so a stuck delivery can never keep an interpreter alive.
- `close()` stops admitting posts, drains in-flight and queued work for up to 10 seconds, then abandons the rest. It is idempotent and safe from any thread. `IncidentClient` is also a context manager.
- `_internal/lifecycle.Lifecycle` is the read/write split the Java SDK gets from a reentrant read-write lock. Python has no such primitive in the standard library, so it is written directly: deliveries run concurrently, a close stops admission and then drains. The drain is bounded, because a Python thread cannot be interrupted and an unbounded wait would hang the process.
- Python cannot interrupt a sleeping thread, so a forced shutdown sets a `threading.Event` that the retry sleeper waits on. That event is the SDK's stand-in for `shutdownNow()` interrupting a backoff.

Never introduce a module-level client, cache, or singleton. A library that owns process-global state cannot be embedded safely.

## 7. Delivery semantics

These are shared with the Java SDK and must stay aligned:

- Authentication is the `X-API-KEY` header. The key is never logged.
- 3 second connect timeout, 5 second socket timeout.
- HTTP 429, 500, 502, 503 and 504, plus failures that never reached a status line, retry with a 0.5s, 1s, 2s, 4s, 8s backoff. Every other status fails immediately.
- A resolved service key of `None` is omitted from the payload rather than sent as null.
- A request's own `service_key` overrides the client's. Service routing refuses a request that carries one instead of ignoring it.
- Wire field names and order: `serviceKey`, `title`, `source`, `severity`, `priority`, `srcTimestamp`, `component`, `group`, `type`, `detailsJSON`. `details` is JSON text supplied by the caller and is sent as `detailsJSON`.
- `srcTimestamp` is milliseconds since the Unix epoch, matching the wire contract rather than Python's seconds convention.

Connection handling differs from Java by necessity: `http.client` has no permit model, so the pool keeps up to 20 idle keep-alive connections and opens an extra connection during a burst rather than blocking an incident path. A pooled connection that fails on first use is retried once on a fresh connection, because a server may close an idle keep-alive connection at any time; that recovery is not counted as a delivery retry.

## 8. Build, test, release

- `scripts/build-canonical.sh` byte-compiles the tree, then builds the sdist and universal wheel, installing the pinned tooling from `requirements-build.txt` first. CI runs it inside `python:2.7-slim`, because building on the oldest interpreter is what makes the 2.7 claim real; the script also runs on Python 3 for local convenience and says so when it does.
- `requirements-build.txt` is marker-based, so one file serves every interpreter. The Python 2.7 entries are exact, because only one release pair still supports it. The Python 3 entries are upper-bounded because `setuptools` 70 and `wheel` 0.45 dropped universal-wheel support; raising those bounds means giving up the single-artifact rule.
- `setuptools` is a build-time requirement, never a runtime one. If `src/` ever imports it, the dependency-free claim in the published metadata becomes false.
- `scripts/verify-runtime.sh` installs a wheel, byte-compiles the installed package, runs the full suite against the installed bytes, and runs the external consumer. CI runs it once per interpreter in the matrix. Keep both scripts POSIX `sh`.
- PyPI receives one universal release, not one artifact per interpreter. Build once, checksum, run those exact bytes on every supported interpreter, then publish them without rebuilding.
- `src/oppex_sdk/_version.py` is the only place the version lives. `setup.py` reads it textually so packaging never imports the package it is building, and CI rewrites it from a `python-v*` tag.
- Releases use `python-vX.Y.Z` tags and are independent of the Java SDK's `java-v*` tags and version numbers.
- PyPI uploads authenticate with an API token stored only as a secret in the protected `pypi`
  GitHub environment, so no other workflow or branch can reach it. The token value never appears
  in source, in workflow YAML, or in a log. Trusted publishing removes the token entirely and
  remains the better option whenever it can be set up.

When adding an interpreter to the matrix, add it to `.github/workflows/python-compatibility.yml`, the `tox.ini` envlist, the `setup.py` classifiers, and the README table together.

## 9. Intentional differences from the Java SDK

| Java | Python | Reason |
| --- | --- | --- |
| Builders for the client and request | Keyword arguments | Keyword arguments already give the builder's readability; a builder would be unidiomatic ceremony. |
| `Closeable` and try/finally | `close()` and a context manager | |
| `enum Severity` | Hand-rolled constant class | `enum` does not exist on Python 2.7, and the type must be the same on every runtime. |
| Apache HttpClient and Jackson, shaded into a fat JAR | `http.client` and `json` | Python ships both, so the SDK stays dependency-free and needs no shading. |
| Pool blocks when all 20 permits are held | Pool opens an extra connection | `http.client` has no permit model, and blocking an incident path is worse than an extra socket. |
| `shutdownNow()` interrupts retry backoff | Shutdown event cuts the backoff short | Python threads cannot be interrupted. |
| `AtomicLong` counters | Lock-guarded counters | Python has no atomic integer. |
| No SDK `User-Agent` | `oppex-integration-sdk-python/<version>` | `http.client` sends none at all, and support needs to identify the client. |

Adding to this table is normal. Silently diverging is not: a behavioural difference that is not written down here becomes a support incident.

## 10. Change-management rules

- Run `PYTHONPATH=src python -m unittest discover -s tests -t .` before proposing any change.
- Add a regression test with any behaviour change. Tests must pass on 2.7 and on current Python 3, which rules out `assertRaisesRegex`, `assertCountEqual`, `mock`, and `subTest`.
- Update the README and this guide when semantics, packaging, compatibility, or the public surface changes.
- Never add a dependency, including a test-only one, without recording the decision here first. Adding one means writing down what it buys that the standard library cannot.
- Never commit `build/`, `dist/`, `*.egg-info/`, `__pycache__/`, `.pyc`, or `.tox/`.
- Never log, or place in source or workflow YAML, an API key or PyPI credential.
- Preserve the Java SDK and other language directories when making a Python change.
