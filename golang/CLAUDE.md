# Oppex Go SDK Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file is the
durable engineering context for the Go SDK directory. It records why the project is
structured as it is, which decisions are intentional, and how to evolve it without
breaking the shared incident contract, the public API, or delivery semantics.

The Go SDK was written as a peer of the [Java SDK](../java/CLAUDE.md), which is the
reference implementation of the shared contract. Where the two intentionally
differ, the difference is listed in [section 8](#8-intentional-differences-from-the-java-sdk)
and in the README, not left for a reader to discover.

## 1. Mission

Give Go applications a minimal API for posting incidents to:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

Callers should not need to understand `net/http`, connection pooling, JSON
encoding, retry classification, bounded queues, or shutdown coordination.

```go
client, err := oppex.New(oppex.Config{APIKey: "api-key", ServiceKey: "service-key"})
```

Create one client per application, share it across goroutines, and close it during
application shutdown.

## 2. Non-negotiable constraints

- **Current stable Go only.** The `go` directive tracks the current stable
  release. There is no older-runtime compatibility floor to preserve, and no
  equivalent of the Java 7 / Python 2.7 / Node 8 gymnastics the earlier SDKs
  carry. Raising the directive when Go releases is expected maintenance, not a
  breaking change to justify.
- **Zero third-party dependencies, runtime and test.** `go.mod` has no `require`
  block and must not grow one. The standard library covers HTTP, TLS, JSON,
  logging and testing.
- **No network in tests beyond loopback.** Integration tests run against
  `httptest.NewServer`.
- **No framework imports.** Framework code belongs in `examples/`.
- **The public surface is what is exported from package `oppex`.** Everything
  else is lowercase and may change in any release. Exporting a name is an API
  commitment; treat it as one.

## 3. Directory ownership

```text
golang/
├── CLAUDE.md          # This guide
├── README.md          # User-facing documentation
├── LICENSE            # Copy of the root license
├── go.mod             # Module root. No require block, by design.
├── oppex/             # The library. One package; lowercase is the encapsulation.
│   ├── doc.go         # Package documentation
│   ├── severity.go  request.go  response.go  errors.go   # Public model
│   ├── client.go      # Public façade
│   ├── transport.go  wire.go  retry.go  dispatcher.go  droplog.go   # Internals
│   └── *_test.go      # Unit and loopback integration tests
└── examples/plain/    # Runnable example; never imported by the library
```

Everything the SDK needs to build, test and release lives in this directory.
Nothing here may require another language's toolchain, and nothing belongs at
repository root except the workflow YAML GitHub can only discover there.

### Why one package, not core/http/bundle like Java

Java's `sdk-core`/`sdk-http`/`sdk-bundle` split exists to solve two Java-specific
problems: a circular dependency between the public façade and its only
implementation, and shading third-party runtime dependencies into one fat jar. Go
has neither problem. Lowercase identifiers already hide the transport, codec,
retry policy and dispatcher from consumers without a package boundary, and there
is nothing to shade because there are no dependencies.

An `internal/` tree was considered and rejected: the codec and dispatcher both
need the `IncidentRequest` type, so splitting them out would create an import
cycle that only a neutral duplicate type could break — Java's exact problem,
reintroduced for no benefit.

## 4. Public API boundary

Supported API is exactly the exported surface of package `oppex`:

- `Client`, `New`, `Config`
- `IncidentRequest`, `IncidentResponse`, `Severity` and its constants
- `IncidentError`, `ErrInvalidRequest`, `ErrClientClosed`, `NoStatusCode`
- `DefaultEndpoint`

Error classification is part of the contract, because callers write `errors.Is`
and `errors.As` against it:

| Situation | Returned |
| --- | --- |
| Invalid configuration or incident | an error wrapping `ErrInvalidRequest` |
| Any post after `Close` | `ErrClientClosed` |
| Delivery failure | `*IncidentError` |

Never let a `net`, `tls`, `net/http` or `encoding/json` error escape a public
method on its own. `IncidentError` wraps it, so a caller can still reach it with
`errors.As` without depending on which package produced it.

## 5. Validation is a boundary concern

`IncidentRequest.normalize` validates everything and applies every default in one
place, so a synchronous and an asynchronous post can never disagree about what was
sent. `Post` and `PostAsync` both call it on the **calling goroutine**, before any
work is queued: a malformed incident is the caller's bug, and it must surface at
the call site rather than as a log line inside a worker.

`Validate` is the same code path, exported so a caller can reject bad input
earlier. It is not a second implementation.

## 6. Concurrency and lifecycle

- `Client` is safe for concurrent use and intended to be shared. It owns a
  connection pool, two worker goroutines, and a retry policy.
- `Post` and `PostWithServiceRouting` run and retry on the calling goroutine and
  honor the caller's `context.Context`, including during backoff sleeps.
- `PostAsync` and `PostAsyncWithServiceRouting` queue and return. The queue is
  bounded at 5000; when full the oldest queued incident is dropped so the newest
  still has a chance, and submission never blocks the application.
- Drops are always counted and logged at most once a minute. A saturated queue
  drops continuously, so per-drop logging would replace one overload with another.
- `Close` stops admitting posts, drains for up to 10 seconds, then abandons the
  rest. It is idempotent and safe from any goroutine.

Two lifecycle details are easy to get wrong and were both found by tests:

**`deliver` deliberately takes no lifecycle lock.** `Close` holds the write lock
while it drains the dispatcher. A queued task that waited for a read lock inside
`deliver` would block on the very drain it is supposed to finish, and `Close`
would always burn its full 10 second timeout. Synchronous posts take the read lock
in `postSynchronously` instead, one layer above; queued work relies on `Close`
draining the dispatcher fully before the transport is closed. This mirrors the
Java SDK, whose asynchronous path also bypasses its read-write lock.

**A goroutine cannot be interrupted.** Java's `close()` calls `shutdownNow()`,
which interrupts a worker blocked in a socket read. Go has no equivalent, so the
dispatcher hands every task a shared `context.Context` and cancels it when the
drain times out. That cancellation aborts the in-flight HTTP request, which is
what actually lets `Close` return. `Close` deliberately does not wait for the
abandoned workers afterwards, so it always returns within its timeout even if a
task ignores its context.

## 7. Delivery policy is not configuration

`Config` exposes `APIKey`, `ServiceKey` and `Logger`. That is the whole surface.

Do not add timeout, retry, queue, worker, proxy, endpoint, connection-pool or
serializer knobs without an explicit product decision first. The delivery policy —
timeouts, the 0.5/1/2/4/8 second backoff, the retryable status list, the queue
bound, the drain timeout — is part of the cross-language incident contract in the
root guide, not a per-caller setting. Changing any of those values is a
cross-language change.

`Client.retryDelays` is a field rather than a direct read of `defaultRetryDelays`
so tests can exercise the real retry loop without waiting out the production
schedule. It is unexported and reachable only from inside the package; it is not
a disguised knob. `OPPEX_TEST_ENDPOINT_URL` serves the same purpose for the
endpoint and is equally not public API — it exists so tests can point the whole
delivery path at a loopback server rather than adding a configurable endpoint to
`Config` solely to simplify testing.

## 8. Intentional differences from the Java SDK

- **`context.Context` on every synchronous post.** Java, Python and Node have no
  equivalent. Cancellation is honored during the backoff sleep as well as during
  the request itself, and a cancelled context is reported as an `*IncidentError`
  wrapping `context.Canceled` so callers still see one error type from every post.
- **`PostAsync` returns an error.** Java's `postAsync` returns void because
  validation already happened in the request builder. Go has no builder, so
  validation happens at post time, and reporting it synchronously is the only way
  to keep the failure at the call site.
- **A blank optional string means absent.** Java rejects an optional field that is
  present but blank, because `null` and `""` are distinguishable there. A Go zero
  value cannot be told apart from an unset field, so `""` means absent for every
  optional field. `Title` and `Source` are required, so a blank value there is
  still an error.
- **`Priority` 0 and `SrcTimestamp` 0 mean "use the default".** Both are out of
  their valid ranges anyway, so treating the zero value as "unset" costs nothing
  and keeps a plain struct literal usable without naming every field.
- **No separate socket timeout.** Go has no single equivalent knob.
  `net.Dialer.Timeout` covers the 3 second connect budget, `ResponseHeaderTimeout`
  covers the 5 second read budget, and `http.Client.Timeout` bounds the whole
  attempt as a backstop against a response that never ends.
- **Response bodies are read through an `io.LimitReader`.** The API returns a
  small envelope; a misbehaving proxy should not get to dictate this client's
  memory use.
- **`log/slog` rather than a bespoke logger interface.** Go has a standard
  structured logging facade, so the SDK uses it instead of exporting its own
  logger type the way the Node SDK has to.

## 9. Logging rules

- Internal logging goes to `Config.Logger`, defaulting to `slog.Default()`.
- Asynchronous delivery failures log at **debug**, matching Java's `Level.FINE`
  choice: an application that fires and forgets should not have its logs flooded
  by an outage it deliberately chose not to observe.
- Queue drops and close-time abandonment log at **warn**. These are losses the
  host should see.
- Individual retry attempts are never logged. Only the final failure is reported,
  and only a failure that never reached a status line carries an attempt count —
  an HTTP failure already explains itself through its status.
- Never log the API key, a response body, or anything derived from one. A proxy
  error page can echo request headers back, which is why `parseResponse` reports a
  generic message rather than the body it failed to parse.

## 10. Testing

```shell
cd golang
go build ./... && go vet ./... && go test -race ./...
```

`-race` is not optional. The dispatcher, the drop logger and the client lifecycle
are all concurrent, and every one of the concurrency bugs found while writing this
SDK was found by a race-detector run or a timeout test, not by reading the code.

Integration tests run against `httptest.NewServer`, so the suite is network-free
beyond loopback and never touches the real Oppex service.

CI additionally compiles and runs `.github/smoke/go/consumer.go` against the module
as a consumer would resolve it, which is what proves the published surface is
usable from outside this module rather than only from inside its own tests.

## 11. Releasing

There is no artifact to publish: the Go module proxy serves the module from the
repository, so a release is a tag and nothing else. There is no Go publish
workflow, deliberately.

The tag **must** be `golang/vX.Y.Z`, not `go-vX.Y.Z`. Go requires a subdirectory
module's tags to carry the module's directory prefix, and the proxy will not
resolve the module from an unprefixed tag. This is the one place where Go
overrides the repository's `<language>-vX.Y.Z` tag convention, and it is a Go
requirement rather than a preference.

```shell
git tag golang/v1.0.0
git push origin golang/v1.0.0
```
