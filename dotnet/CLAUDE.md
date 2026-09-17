# Oppex .NET SDK Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file is the
durable engineering context for the .NET SDK directory. It records why the project
is structured as it is, which decisions are intentional, and how to evolve it
without breaking the shared incident contract, the public API, or delivery
semantics.

The .NET SDK was written as a peer of the [Java SDK](../java/CLAUDE.md), which is
the reference implementation of the shared contract. Where the two intentionally
differ, the difference is listed in [section 8](#8-intentional-differences-from-the-java-sdk)
and in the README, not left for a reader to discover.

## 1. Mission

Give .NET applications a minimal API for posting incidents to:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

Callers should not need to understand `HttpClient`, connection pooling, JSON
encoding, retry classification, bounded channels, or shutdown coordination.

```csharp
await using var client = new IncidentClient(new IncidentClientOptions { ApiKey = ..., ServiceKey = ... });
```

Create one client per application, share it across threads, and dispose it during
application shutdown.

## 2. Non-negotiable constraints

- **Current stable .NET only.** `TargetFramework` is a single `net10.0` and moves
  forward with the platform. Do not add multi-targeting: there is no
  older-runtime compatibility floor to preserve, and a second TFM would double
  the build surface and every conditional in the code for no consumer this SDK
  actually has.
- **One dependency: `Microsoft.Extensions.Logging.Abstractions`.** It is
  abstractions-only, so it pulls in no implementation and forces no logging
  choice on the host. Adding a second dependency needs a reason recorded here.
- **`TreatWarningsAsErrors`, with the recommended analyzers on.** This is the
  C# equivalent of `go vet` and `cargo clippy -D warnings` in the sibling SDKs,
  and it is why the logging goes through source-generated delegates rather than
  the `LogWarning` extension methods (CA1848).
- **`IsAotCompatible`.** No reflection, no dynamic code. JSON is written with
  `Utf8JsonWriter` and read with `JsonDocument`; logging uses
  `[LoggerMessage]`. A consumer must be able to trim or publish AOT without this
  SDK being the reason they cannot. Do not introduce
  `JsonSerializer.Serialize<T>` reflection overloads.
- **No network in tests beyond loopback.** Integration tests run against a
  loopback `HttpListener`.
- **No framework or hosting code in `src/`.** No `IServiceCollection` extension,
  no `IHostedService`. Framework integration belongs in `examples/`.
- **The public surface is what is `public` in `Oppex.Integration.Sdk`.**
  Everything in `Internal/` is `internal`, exposed to the test assembly only
  through `InternalsVisibleTo`. Making a type public is an API commitment.

## 3. Directory ownership

```text
dotnet/
├── CLAUDE.md                     # This guide
├── README.md                     # User-facing docs, also packed into the nupkg
├── LICENSE                       # Copy of the root license, packed
├── Directory.Build.props         # TFM, nullable, analyzers, warnings-as-errors
├── Oppex.Integration.Sdk.slnx    # Solution (XML slnx, not the legacy sln)
├── src/Oppex.Integration.Sdk/
│   ├── Severity.cs  IncidentRequest.cs  IncidentResponse.cs
│   ├── IncidentException.cs  IncidentClientOptions.cs
│   ├── IncidentClient.cs         # Public façade
│   └── Internal/                 # internal only
│       ├── HttpTransport.cs  WireCodec.cs  RetryPolicy.cs
│       ├── AsyncDispatcher.cs  RateLimitedDropLogger.cs
│       └── Log.cs                # Every log message, as LoggerMessage delegates
├── tests/Oppex.Integration.Sdk.Tests/   # xUnit v3, plus the loopback StubServer
└── examples/Plain/                      # Runnable example; never packed
```

`Directory.Build.props` holds everything shared by all three projects. Put a new
compiler or analyzer setting there, not in one csproj, unless it genuinely
applies to one project only.

`Log.cs` deliberately holds *every* log message in one file. It is what makes the
SDK's whole logging surface reviewable at a glance — including the fact that none
of it can carry an API key or a response body.

## 4. Public API boundary

Supported API is exactly:

- `IncidentClient`, `IncidentClientOptions`
- `IncidentRequest`, `IncidentResponse`, `Severity`, `SeverityExtensions`
- `IncidentException`
- `IncidentClient.DefaultEndpoint`

Exception mapping is part of the contract, because callers write `catch` clauses
against it:

| Situation | Thrown |
| --- | --- |
| Invalid options or request | `ArgumentException` |
| Any post after disposal | `ObjectDisposedException` |
| Delivery failure | `IncidentException` |
| The caller cancelled | `OperationCanceledException`, unchanged |

That last row matters: `HttpTransport.SendAsync` rethrows an
`OperationCanceledException` unchanged when the *caller's* token fired, and wraps
it as a retryable `IncidentException` otherwise — a bare cancellation there is
`HttpClient.Timeout` expiring, which is a delivery failure, not the caller's
decision. Collapsing those two cases would either retry a cancellation or swallow
a timeout.

Never let an `HttpRequestException`, `IOException`, `SocketException` or
`JsonException` escape a public method. `IncidentException` carries it as
`InnerException`.

## 5. Validation is a boundary concern

`IncidentRequest.Normalize` validates everything and applies every default in one
place, so a synchronous and a queued post can never disagree about what was sent.
`PostAsync` and `Enqueue` both call it on the **calling thread**, before any work
is queued: a malformed incident is the caller's bug, and it must surface at the
call site rather than as a log line inside a worker.

`Validate()` is the same code path, public so a caller can reject bad input
earlier. It is not a second implementation.

Unlike the Java SDK, validation does *not* happen in a constructor. Object
initializer syntax with `required` properties is the idiomatic way to build a DTO
in modern C#, and it leaves no constructor to validate in. `NormalizedRequest` is
the internal "already validated" type that the transport and codec work against,
which is how the type system still distinguishes checked input from raw input.

One rule is easy to get wrong: a C# enum accepts any value of its underlying
type, so `(Severity)99` compiles. `SeverityExtensions.IsDefinedValue` exists
because of that, and `Normalize` calls it.

## 6. Concurrency and lifecycle

- `IncidentClient` is thread safe and intended to be shared. It owns a connection
  pool, two worker tasks, and a retry policy.
- `PostAsync` and `PostWithServiceRoutingAsync` deliver and retry on the caller's
  execution context and honour the caller's `CancellationToken`, including
  during backoff delays.
- `Enqueue` and `EnqueueWithServiceRouting` queue and return. The channel is
  bounded at 5000 with `BoundedChannelFullMode.DropOldest`; enqueueing never
  blocks the application.
- Drops are counted and logged at most once a minute. A saturated queue drops
  continuously, so per-drop logging would replace one overload with another.
- `DisposeAsync` stops admitting posts, drains for up to 10 seconds, then
  abandons the rest. It is idempotent.

Two lifecycle details are deliberate:

**`BoundedChannelFullMode.DropOldest` is the whole queue policy.** The Go, Rust
and Ruby SDKs each hand-write a bounded queue with drop-oldest eviction, because
their standard libraries have nothing equivalent. `System.Threading.Channels` has
exactly this policy built in, including an `itemDropped` callback for the counter.
Do not replace it with a hand-rolled queue.

**Abandonment is cancellation, not thread killing.** `AsyncDispatcher` hands every
task a shared `CancellationToken` and cancels it when the drain times out, which
aborts the in-flight HTTP request rather than waiting for it. That is what keeps
`CloseAsync` inside its own timeout. Java's `close()` uses `shutdownNow()` for the
same purpose; .NET has no thread interrupt worth using, and cancellation is both
safer and more precise.

`Dispose()` exists for callers that cannot await, and it blocks on
`DisposeAsync`. Prefer `await using`.

## 7. Delivery policy is not configuration

`IncidentClientOptions` exposes `ApiKey`, `ServiceKey` and `Logger`. That is the
whole surface.

Do not add timeout, retry, queue, worker, proxy, endpoint, `HttpClient` or
serializer options without an explicit product decision first. The delivery
policy — timeouts, the 0.5/1/2/4/8 second backoff, the retryable status list, the
queue bound, the drain timeout — is part of the cross-language incident contract
in the root guide, not a per-caller setting. Changing any of those values is a
cross-language change.

An `HttpClient`/`IHttpClientFactory` option is the one most likely to be
requested, and it is still a no: the connect timeout, response timeout,
connection cap and attempt budget are contract values, and handing the host the
handler hands them the ability to change all four silently.

Two test seams exist instead, and neither is public API:

- The `internal` `IncidentClient` constructor takes a `TimeProvider` and a retry
  schedule, so tests exercise the real retry loop against a fake clock without
  waiting out the production schedule.
- `OPPEX_TEST_ENDPOINT_URL` redirects the whole delivery path at a loopback
  server. It is an environment variable specifically so the external smoke
  consumer — which only sees the published package — can use it too.

Because that variable is process-global, `IncidentClientTests` is in a
`DisableParallelization` collection. Do not remove that attribute without
replacing the seam first.

## 8. Intentional differences from the Java SDK

- **`Enqueue`, not `PostAsync`, for fire-and-forget.** Java's `postAsync` returns
  void. In .NET an `Async` suffix promises an awaitable, so reusing that name for
  a fire-and-forget method would be actively misleading. `PostAsync` here is the
  *synchronous-semantics* post, awaited for its result.
- **`Enqueue` throws.** Java's `postAsync` cannot fail because validation already
  happened in the request builder. The disposed and service-key checks still have
  to happen somewhere, and throwing them synchronously keeps the failure at the
  call site.
- **`CancellationToken` on every awaited post.** Java, Python and Ruby have no
  equivalent. Cancellation is honoured during the backoff delay as well as during
  the request itself.
- **Validation at post time, not construction.** See §5.
- **`IncidentRequest` and `IncidentResponse` are records.** Value equality, a
  readable `ToString`, and `with` for deriving one request from another.
- **No separate socket timeout knob per phase.** `SocketsHttpHandler.ConnectTimeout`
  covers the 3 second connect budget, `ResponseDrainTimeout` the 5 second read
  budget, and `HttpClient.Timeout` bounds the whole attempt as a backstop.
- **`PooledConnectionLifetime` is two minutes.** Java's pool has no equivalent
  setting, but a .NET `HttpClient` that outlives a DNS change keeps using the old
  address indefinitely without this. It is a platform fix, not a policy change.
- **Response bodies are read through a 1 MiB cap.** The API returns a small
  envelope; a misbehaving proxy should not get to dictate this client's memory
  use.

## 9. Logging rules

- Every message lives in `Internal/Log.cs` as a `[LoggerMessage]` delegate.
  Adding a call site means adding one there first.
- Queued delivery failures log at **debug**, matching Java's `Level.FINE` choice:
  an application that fires and forgets should not have its logs flooded by an
  outage it deliberately chose not to observe.
- Queue drops and close-time abandonment log at **warn**. These are losses the
  host should see. The close-time count is logged directly rather than through
  the rate-limited counter, because a rate-limited counter's final batch can go
  unreported — a real gap in the Java SDK, not worth reproducing.
- Individual retry attempts are never logged. Only the final failure is thrown,
  and only a failure that never reached a status line carries an attempt count.
- Never log the API key, a response body, or anything derived from one. A proxy
  error page can echo request headers back, which is why `WireCodec.ParseResponse`
  throws a generic message rather than the body it failed to parse.

## 10. Testing

```shell
cd dotnet
dotnet build Oppex.Integration.Sdk.slnx -c Release
dotnet test  Oppex.Integration.Sdk.slnx -c Release
```

`StubServer` is a loopback `HttpListener` written in the test project rather than
a mocking library: this SDK has no test dependencies beyond the runner, and a stub
small enough to read in one screen is a better guarantee than a mock framework's
matching rules. It reserves a port with a throwaway `TcpListener` first, because
`HttpListener` prefixes need a concrete port rather than 0.

`FakeTimeProvider` (from `Microsoft.Extensions.TimeProvider.Testing`) is what
makes the drop-logger interval and the cancellation-during-backoff tests
deterministic rather than timing-dependent.

CI additionally restores and runs `.github/smoke/dotnet/` against the **packed
`.nupkg`** from a local feed, which is what proves the published package — not
just the project reference — is usable from outside.

## 11. Releasing

Tag `dotnet-vX.Y.Z`. The publish workflow runs the compatibility workflow first,
packs the library, verifies that exact `.nupkg` against the external consumer, and
pushes the same file without rebuilding — the same "build once, verify those
bytes, publish those bytes" shape the Java and Python releases use.

Bump `<Version>` in `src/Oppex.Integration.Sdk/Oppex.Integration.Sdk.csproj` as a
normal reviewed change. The tag's version must match it; the workflow fails if it
does not.

The NuGet API key lives in the protected `nuget` GitHub environment and is never
echoed, persisted, or passed as a command-line argument. Prefer NuGet trusted
publishing over a long-lived key when it can be configured.
