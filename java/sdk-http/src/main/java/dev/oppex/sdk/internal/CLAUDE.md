# Internal Delivery Packages Guide

Read the repository and `sdk-http` guides first. All code below this directory is unsupported implementation detail.

## Package boundaries

- `async` owns queueing, workers, rejection, drop tracking, and bounded executor shutdown.
- `http` owns JSON wire encoding, Apache request execution, response parsing, and HTTP status classification.
- `retry` owns attempt count, backoff, I/O retry, retryable SDK failure handling, and interruption.
- `metrics` owns client-local counters only.

Keep responsibilities in their current package. In particular:

- HTTP code must not decide how long to sleep.
- Retry code must not construct HTTP requests.
- Async code must not serialize incidents.
- Metrics code must not log or control delivery.

## Visibility

Use package-private visibility whenever callers are in the same package. Some cross-package entry points are public because Java 7 has no module exports and the public façade lives in another package. That modifier does not make these types supported API.

Do not make internal types appear in the supported façade's public method signatures.

## Shared invariants

- No static mutable runtime state.
- Collaborators are injected through constructors where tests need deterministic behavior.
- No framework annotations.
- No sensitive logging.
- No unbounded queues or caches.
- No swallowed interruption.
- No real network or real-time backoff in unit tests.

