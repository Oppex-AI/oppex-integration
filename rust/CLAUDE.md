# Oppex Rust SDK Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file is the
durable engineering context for the Rust SDK directory. It records why the crate
is structured as it is, which decisions are intentional, and how to evolve it
without breaking the shared incident contract, the public API, or delivery
semantics.

The Rust SDK was written as a peer of the [Java SDK](../java/CLAUDE.md), which is
the reference implementation of the shared contract. Where the two intentionally
differ, the difference is listed in [section 8](#8-intentional-differences-from-the-java-sdk)
and in the README, not left for a reader to discover.

## 1. Mission

Give Rust applications a minimal API for posting incidents to:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

Callers should not need to understand HTTP, TLS, connection pooling, JSON
encoding, retry classification, bounded queues, or shutdown coordination.

```rust
let client = IncidentClient::builder().api_key("api-key").service_key("service-key").build()?;
```

Create one client per application, share it across threads, and close it (or let
it drop) during application shutdown.

## 2. Non-negotiable constraints

- **Current stable Rust only.** `rust-version` and `edition` track the current
  stable release. There is no older-toolchain compatibility floor to preserve,
  and no equivalent of the Java 7 / Python 2.7 / Node 8 gymnastics the earlier
  SDKs carry. Raising the floor when Rust releases is expected maintenance.
- **`unsafe_code = "forbid"`.** Nothing in this crate needs it, and the lint is
  set to `forbid` rather than `deny` specifically so a future change cannot
  quietly `#[allow]` its way past it.
- **Three runtime dependencies, and a reason for each.** `ureq` (blocking HTTP +
  rustls), `serde_json` (response parsing and string escaping), `log` (facade
  only). Adding a fourth needs a reason recorded here.
- **No async runtime, and no async API.** Posting an incident is rare, short and
  usually fire-and-forget, and the asynchronous path already has its own worker
  threads. Pulling in Tokio would make every consumer inherit a runtime for that.
- **No network in tests beyond loopback.** Integration tests run against a
  `TcpListener`-based stub written in the test module, not a mocking crate.
- **`cargo clippy --all-targets -- -D warnings` must pass**, with `clippy::all`
  and `clippy::pedantic` enabled in `Cargo.toml`, and `cargo fmt --check` must be
  clean.
- **The public surface is exactly what `lib.rs` re-exports.** Everything under
  `internal/` is `pub(crate)`. Exporting a name is an API commitment.

## 3. Directory ownership

```text
rust/
├── CLAUDE.md          # This guide
├── README.md          # User-facing documentation
├── LICENSE            # Copy of the root license
├── Cargo.toml         # Package metadata, dependencies, lints, `include` list
├── Cargo.lock         # Committed: CI and the release build resolve identically
├── rustfmt.toml       # 110-column width, enforced by `cargo fmt --check`
├── src/
│   ├── lib.rs         # Public re-exports only
│   ├── severity.rs  request.rs  response.rs  error.rs   # Public model
│   ├── client.rs      # Public façade, and the loopback integration tests
│   └── internal/      # pub(crate) only: transport, wire, retry, dispatcher,
│                      # drop_logger, interrupt
├── tests/public_api.rs  # Compiles against the crate as an outside consumer
└── examples/plain.rs    # Runnable example; never part of the published crate
```

`Cargo.toml`'s `include` list is the published file set. It deliberately excludes
`tests/` and `examples/`, so the published crate is the library and its metadata
and nothing else. A file missing from that list is caught before it can reach
crates.io, because the CI smoke consumer depends on the **packaged** directory
(`target/package/<name>-<version>/`), not on the working tree.

`Cargo.lock` is committed even though this is a library. Cargo ignores it for
downstream consumers, so it costs them nothing, and it makes this repository's own
CI and release builds reproducible rather than resolving fresh dependency versions
on every run.

## 4. Public API boundary

Supported API is exactly what `lib.rs` re-exports:

- `IncidentClient`, `IncidentClientBuilder`
- `IncidentRequest`, `IncidentRequestBuilder`, `IncidentResponse`, `Severity`
- `IncidentError`, `NO_STATUS_CODE`
- `DEFAULT_ENDPOINT`

`IncidentError` is an enum, and its variants are part of the contract because
callers `match` on them:

| Variant | When |
| --- | --- |
| `InvalidRequest` | configuration or incident failed validation; nothing was sent |
| `ClientClosed` | the post happened after `close()` |
| `Delivery` | delivery was attempted and failed |

Never let a `ureq`, `serde_json` or `io` error escape a public method on its own.
`IncidentError::Delivery` carries it in `source`, so a caller can still reach it
through `std::error::Error::source` without depending on which crate produced it.

Every public type implements `Debug`. `AsyncDispatcher` implements it by hand,
because a queued task is a boxed closure and cannot derive it; that hand-written
impl is why `IncidentClient` can derive `Debug` at all.

## 5. Validation is a boundary concern

`IncidentRequestBuilder::build` and `IncidentClientBuilder::build` validate
everything, so a malformed incident fails at the call site instead of inside a
worker thread where only a log line would remain. This mirrors the Java SDK
exactly, and it is why the request type has private fields and getters rather
than public fields: an already-built `IncidentRequest` is, by construction,
valid.

One rule is easy to get wrong: an optional string accepts absence (`None`) but
rejects a blank value. `"" ` or `"   "` in `component`, `group`, `type`,
`details` or `service_key` is nearly always a bug at the call site, so it is
rejected rather than silently sent.

## 6. Concurrency and lifecycle

- `IncidentClient` is `Send + Sync` and intended to be shared. It owns a
  connection pool, two worker threads, and a retry policy.
- `post` and `post_with_service_routing` run and retry on the calling thread.
- `post_async` and `post_async_with_service_routing` queue and return. The queue
  is bounded at 5000; when full the oldest queued incident is dropped so the
  newest still has a chance, and submission never blocks the application.
- Drops are always counted and logged at most once a minute. A saturated queue
  drops continuously, so per-drop logging would replace one overload with another.
- `close()` stops admitting posts, drains for up to 10 seconds, then abandons the
  rest. It is idempotent, safe from any thread, and runs from `Drop`.

Three lifecycle details are easy to get wrong and are all deliberate:

**All dispatcher lifecycle state lives behind one mutex.** `tasks`, `accepting`,
`draining` and `active` are fields of a single `State` rather than separate
atomics. Splitting them reintroduces the classic missed-wakeup race: a worker
reads `draining == true`, `close` then clears it and calls `notify_all`, and the
worker only afterwards starts waiting — on a notification that already happened.
Keeping the flag inside the same mutex the `Condvar` waits on closes that window.

**`close()` does not join the worker threads.** A Rust thread cannot be
interrupted, so joining one that is blocked in an HTTP attempt would push `close`
past its own timeout by up to the attempt timeout. Java makes the same trade: it
waits for the drain, calls `shutdownNow()`, and returns without waiting for
whatever that failed to interrupt. An idle worker exits as soon as it sees
`draining == false`; a busy one exits when its current attempt ends, which the
8 second attempt timeout already bounds.

**A backoff waits on a `Condvar`, not `thread::sleep`.** `Interrupt` is this
SDK's stand-in for interrupting a sleeping thread: `close()` signals it before
draining, so a worker sitting in an 8 second backoff gives up immediately instead
of consuming the entire 10 second drain budget. This is the same problem the
Python SDK solves with a `threading.Event`.

Every `Mutex` lock recovers from poisoning with `unwrap_or_else(PoisonError::into_inner)`
rather than `unwrap()`. A panicking task must not wedge delivery and shutdown for
the whole process, and the state behind these locks stays consistent across a
panic.

## 7. Delivery policy is not configuration

`IncidentClientBuilder` exposes `api_key` and `service_key`. That is the whole
public surface.

Do not add timeout, retry, queue, worker, proxy, endpoint, connection-pool or
serializer knobs without an explicit product decision first. The delivery policy —
timeouts, the 0.5/1/2/4/8 second backoff, the retryable status list, the queue
bound, the drain timeout — is part of the cross-language incident contract in the
root guide, not a per-caller setting. Changing any of those values is a
cross-language change.

`IncidentClientBuilder::endpoint` and `::retry_delays` exist, but both are
`#[cfg(test)]` and `pub(crate)`: they do not exist in a released build at all.
They let in-crate tests point the whole delivery path at a loopback server and run
the real retry loop without waiting out the production schedule. The
`OPPEX_TEST_ENDPOINT_URL` environment variable serves the same purpose for the
external smoke consumer, which cannot reach a `pub(crate)` seam. Neither is public
API, and neither exists to make the endpoint configurable.

## 8. Intentional differences from the Java SDK

- **`Drop` closes the client.** Java requires an explicit `close()` in a
  `finally` block or try-with-resources. Rust has deterministic destruction, so
  forgetting to close cannot silently leak a connection pool here.
- **`post_async` returns `Result`.** Java's `postAsync` returns void because
  validation already happened in the request builder. Here the closed-client and
  service-key checks still have to happen somewhere, and reporting them
  synchronously keeps the failure at the call site.
- **Errors are an enum, not an exception hierarchy.** Java distinguishes
  `IllegalArgumentException`, `IllegalStateException` and `IncidentException`;
  `IncidentError`'s three variants carry exactly the same distinction in the
  shape Rust callers expect.
- **`incident_type`, not `type`.** `type` is a Rust keyword. The wire field is
  still `type`.
- **No separate socket timeout knob per phase.** `timeout_connect` covers the
  3 second connect budget, `timeout_recv_response` the 5 second read budget, and
  `timeout_global` bounds the whole attempt as a backstop.
- **Response bodies are read through a byte limit.** The API returns a small
  envelope; a misbehaving proxy should not get to dictate this client's memory
  use.
- **The wire payload is built by hand, not serialized from a struct.** It keeps
  the agreed field order without a `preserve_order` feature, and it makes "absent
  is omitted, never null" a property of the code rather than of a `skip`
  attribute. String values still go through `serde_json` for escaping, so the
  hand-built object is correctly encoded.
- **Logging goes through the `log` facade** rather than a bespoke logger type.
  Rust has one near-universal facade; unlike Node, this SDK does not need to
  export its own.

## 9. Logging rules

- Everything goes through `log`. It is a no-op until the host installs a logger,
  so this SDK never decides where a host's logs go.
- Asynchronous delivery failures log at **debug**, matching Java's `Level.FINE`
  choice: an application that fires and forgets should not have its logs flooded
  by an outage it deliberately chose not to observe.
- Queue drops and close-time abandonment log at **warn**. These are losses the
  host should see. The close-time count is logged directly rather than through
  the rate-limited counter, because a rate-limited counter's final batch can go
  unreported — a real gap in the Java SDK, not worth reproducing.
- Individual retry attempts are never logged. Only the final failure is reported,
  and only a failure that never reached a status line carries an attempt count.
- Never log the API key, a response body, or anything derived from one. A proxy
  error page can echo request headers back, which is why `parse_response` reports
  a generic message rather than the body it failed to parse.

## 10. Testing

```shell
cd rust
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Unit tests live beside the code they cover, in `#[cfg(test)] mod tests`. The
client's loopback integration tests live in `src/client.rs` rather than `tests/`
for one specific reason: they need the `#[cfg(test)]` endpoint and retry seams,
which an integration test in `tests/` cannot reach, and the alternative —
mutating `OPPEX_TEST_ENDPOINT_URL` from several test threads at once — is a data
race that Rust 2024 correctly makes `unsafe`.

`tests/public_api.rs` is the counterpart: it compiles against the crate exactly as
an outside consumer does, so a type or method dropping out of `lib.rs`'s re-exports
breaks the build. It is network-free; every case there fails validation before any
HTTP attempt.

CI additionally runs `.github/smoke/rust/` against the **packaged** crate, which is
what catches a file missing from `Cargo.toml`'s `include` list before it reaches
crates.io.

## 11. Releasing

Tag `rust-vX.Y.Z`. The publish workflow runs the compatibility workflow first,
packages the crate, verifies those exact bytes against the external consumer, and
publishes them without rebuilding — the same "build once, verify those bytes,
publish those bytes" shape the Java and Python releases use.

Bump `version` in `Cargo.toml` as a normal reviewed change and run `cargo build`
so `Cargo.lock` picks the bump up in the same diff. The tag's version must match
the manifest's; the workflow fails if it does not.

crates.io credentials live in the protected `crates-io` GitHub environment and
are never echoed, persisted, or passed as a command-line argument.
