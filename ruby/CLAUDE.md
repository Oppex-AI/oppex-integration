# Oppex Ruby SDK Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file is the
durable engineering context for the Ruby SDK directory. It records why the gem is
structured as it is, which decisions are intentional, and how to evolve it without
breaking the shared incident contract, the public API, or delivery semantics.

The Ruby SDK was written as a peer of the [Java SDK](../java/CLAUDE.md), which is
the reference implementation of the shared contract, and follows the
[Python SDK](../python/CLAUDE.md) closely where a dynamic language needs a
different answer than a static one. Where any of them intentionally differ, the
difference is listed in [section 8](#8-intentional-differences-from-the-java-sdk)
and in the README, not left for a reader to discover.

## 1. Mission

Give Ruby applications a minimal API for posting incidents to:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

Callers should not need to understand `Net::HTTP`, TLS, JSON encoding, retry
classification, bounded queues, or shutdown coordination.

```ruby
client = Oppex::IncidentClient.new(api_key: "api-key", service_key: "service-key")
```

Create one client per application, share it across threads, and close it during
application shutdown.

## 2. Non-negotiable constraints

- **Current stable Ruby only.** `required_ruby_version` is `>= 3.2` — the floor
  `Data.define` sets — and moves forward with the language. There is no
  older-runtime compatibility to preserve, and no equivalent of the Java 7 /
  Python 2.7 / Node 8 gymnastics the earlier SDKs carry.
- **Zero runtime dependencies.** `net/http`, `json` and `socket` are standard
  library. The gemspec has no `add_dependency` and must not grow one without a
  decision recorded here. `logger` is deliberately *not* required — see §8.
- **Zero third-party test dependencies beyond the toolchain.** Tests use
  `minitest` and a `TCPServer` stub written in `test/test_helper.rb`; there is no
  mocking, VCR or WebMock gem.
- **No network in tests beyond loopback.**
- **`bundle exec rake` must be clean** — RuboCop first, then the suite. RuboCop
  is the Ruby equivalent of `go vet` and `cargo clippy` in the sibling SDKs.
- **No framework code in `lib/`.** Framework integrations belong in `examples/`.
- **The public surface is what `lib/oppex_sdk.rb` loads and documents.**
  Everything under `Oppex::Internal` is private and may change in any release.

## 3. Directory ownership

```text
ruby/
├── CLAUDE.md           # This guide
├── README.md           # User-facing documentation
├── LICENSE             # Copy of the root license, shipped in the gem
├── oppex_sdk.gemspec   # Packaging; reads the version from lib/
├── Gemfile             # Development dependencies only
├── Rakefile            # `rake` runs rubocop then the tests
├── .rubocop.yml        # Style rules, with a reason recorded for each exception
├── lib/
│   ├── oppex_sdk.rb            # Entry point: requires and module documentation
│   └── oppex_sdk/
│       ├── version.rb  endpoint.rb  errors.rb  severity.rb
│       ├── incident_request.rb  incident_response.rb
│       ├── logging.rb          # The default stderr sink
│       ├── incident_client.rb  # Public façade
│       └── internal/           # Not public API
│           ├── http_executor.rb  wire_codec.rb  retry_executor.rb
│           └── async_dispatcher.rb  rate_limited_drop_logger.rb  interrupt.rb
├── test/               # minitest; test_helper.rb holds the loopback stub server
└── examples/           # Runnable examples; never required by the library
```

`gemspec.files` is the published file set: `lib/**/*.rb`, the README and the
LICENSE. It deliberately excludes `test/` and `examples/`. A file missing from
that set is caught before the gem can reach RubyGems, because the CI smoke
consumer installs the **built gem** into a throwaway `GEM_HOME` rather than
adding `lib/` to the load path.

## 4. Public API boundary

Supported API is exactly:

- `Oppex::IncidentClient` (and `IncidentClient.open`)
- `Oppex::IncidentRequest`, `Oppex::IncidentResponse`, `Oppex::Severity`
- `Oppex::Error`, `Oppex::ClientClosedError`, `Oppex::IncidentError`
- `Oppex::StderrLogger`, `Oppex::DEFAULT_ENDPOINT`, `Oppex::VERSION`

`Oppex::Internal` and everything under it is private.

Exception mapping is part of the contract, because callers write `rescue` clauses
against it. It matches the Python SDK's mapping, which is the closest sibling:

| Situation | Raised |
| --- | --- |
| Invalid argument value | `ArgumentError` |
| Argument of the wrong type | `TypeError` |
| Any post after `close` | `Oppex::ClientClosedError` |
| Delivery failure | `Oppex::IncidentError` |

`ClientClosedError` and `IncidentError` both descend from `Oppex::Error`, so one
`rescue Oppex::Error` catches everything this SDK raises on its own without also
swallowing an `ArgumentError` from the caller's own code.

Do not let a `Net::HTTP`, `OpenSSL`, `Socket`, `Resolv` or `JSON` exception
escape a public method. `HttpExecutor#send_request` rescues `StandardError`
deliberately rather than an enumerated list: those libraries between them raise
well over a dozen classes, and an omission would escape as a raw exception from a
public method. The original is preserved on `IncidentError#cause_error`.

## 5. Validation is a boundary concern

`IncidentRequest#initialize` and `IncidentClient#initialize` validate everything
and then `freeze`, so a malformed incident fails at the call site instead of
inside a worker thread where only a log line would remain. An already-built
`IncidentRequest` is, by construction, valid and immutable.

Two rules are easy to get wrong:

- An optional string accepts `nil` for "absent" but rejects a blank string, which
  is nearly always a bug at the call site.
- `true` and `false` are not `Integer` in Ruby, so numeric validation needs no
  boolean special case — unlike the Python SDK, where `bool` is an `int` and has
  to be rejected explicitly. Do not copy that guard across; it would be dead code
  here.

## 6. Concurrency and lifecycle

- `IncidentClient` is thread safe and intended to be shared. It owns two worker
  threads, a retry policy, and an HTTP executor.
- `post` and `post_with_service_routing` run and retry on the calling thread.
- `post_async` and `post_async_with_service_routing` queue and return. The queue
  is bounded at 5000; when full the oldest queued incident is dropped so the
  newest still has a chance, and submission never blocks the application.
- Drops are always counted and logged at most once a minute. A saturated queue
  drops continuously, so per-drop logging would replace one overload with another.
- `close` stops admitting posts, drains for up to 10 seconds, then abandons the
  rest. It is idempotent and safe from any thread. `IncidentClient.open` closes
  in an `ensure`, so a raising block still closes.

Three lifecycle details are deliberate:

**All dispatcher lifecycle state lives behind one mutex.** `@tasks`, `@accepting`,
`@draining` and `@active` are guarded by the same mutex the `ConditionVariable`
waits on. Splitting them reintroduces the classic missed-wakeup race: a worker
reads `@draining` as true, `close` then clears it and broadcasts, and the worker
only afterwards starts waiting — on a broadcast that already happened.

**`close` does not join the worker threads without a bound.** A Ruby thread
cannot be interrupted safely mid-request, so waiting on one blocked in an HTTP
attempt would push `close` past its own timeout. Java makes the same trade: it
waits for the drain, calls `shutdownNow`, and returns without waiting for whatever
that failed to interrupt. `Thread#kill` is deliberately not used — killing a
thread mid-`Net::HTTP` can leave a socket half-written.

**A backoff waits on a `ConditionVariable`, not `sleep`.** `Internal::Interrupt`
is this SDK's stand-in for interrupting a sleeping thread: `close` signals it
before draining, so a worker sitting in an 8 second backoff gives up immediately
instead of consuming the entire 10 second drain budget. This is the same problem
the Python SDK solves with a `threading.Event`. It waits against
`Process::CLOCK_MONOTONIC`, so a system clock adjustment mid-backoff cannot turn
a half-second wait into a very long one.

## 7. Delivery policy is not configuration

`IncidentClient.new` takes `api_key`, `service_key` and `logger`. That is the
whole public surface.

Do not add timeout, retry, queue, worker, proxy, endpoint or serializer keyword
arguments without an explicit product decision first. The delivery policy —
timeouts, the 0.5/1/2/4/8 second backoff, the retryable status list, the queue
bound, the drain timeout — is part of the cross-language incident contract in the
root guide, not a per-caller setting. Changing any of those values is a
cross-language change.

Two test seams exist instead, and neither is public API:

- `OPPEX_TEST_ENDPOINT_URL` redirects the whole delivery path at a loopback
  server. It is an environment variable specifically so the public surface never
  grows an endpoint argument that exists only to ease testing, and so the
  external smoke consumer — which only sees the installed gem — can use it too.
- `client.instance_variable_set(:@retry_delays, ...)` in `test_incident_client.rb`
  shortens the schedule. Reaching into an instance variable from a test is the
  deliberate alternative to adding a public `retry_delays:` argument. If you find
  yourself wanting to make it public, re-read this section first.

Tests that use the environment variable must stay serial. Minitest does not
parallelize by default; do not enable `parallelize_me!` in
`test_incident_client.rb` without replacing that seam first.

## 8. Intentional differences from the Java SDK

- **No connection pool.** Java bounds concurrent connections to 20 with
  `PoolingHttpClientConnectionManager`. A `Net::HTTP` instance is not thread
  safe, and the standard library ships no pool, so this SDK opens a connection
  per attempt. Adding a pooling gem would break the zero-runtime-dependency rule
  for a workload — occasional incident posts — that does not need one.
  `HttpExecutor#close` therefore has nothing to release; it exists so the
  client's lifecycle keeps the same shape as every other Oppex SDK's.
- **The `logger` standard library is not required.** It stops being a default gem
  in Ruby 4.0, so requiring it would turn a dependency-free gem into one with a
  runtime dependency, for four method calls. Any object responding to `debug`,
  `info`, `warn` and `error` works instead, which also means `Rails.logger`,
  SemanticLogger or a plain `Logger` all drop in with no adapter. `StderrLogger`
  is the default, and it swallows an exception from the underlying write: a
  broken logging destination must never crash incident delivery.
- **`IncidentResponse` is a `Data`.** Value semantics, immutability and a
  readable `inspect` come free, and `successful?` is the only method added on top.
- **`IncidentClient.open` takes a block**, mirroring `File.open` and the Python
  SDK's context manager. Java has try-with-resources; Ruby's idiom is a block.
- **`post_async` raises.** Java's `postAsync` returns void because validation
  already happened in the request builder. The closed-client and service-key
  checks still have to happen somewhere, and raising them synchronously keeps the
  failure at the call site.
- **`type` is a plain keyword argument.** Unlike Rust, `type` is not reserved in
  Ruby, so no rename is needed.
- **Response bodies are truncated at 1 MiB.** The API returns a small envelope; a
  misbehaving proxy should not get to dictate this client's memory use.

## 9. Logging rules

- Everything goes through the injected logger. This SDK never decides where a
  host's logs go beyond the stderr default.
- Asynchronous delivery failures log at **debug**, matching Java's `Level.FINE`
  choice: an application that fires and forgets should not have its logs flooded
  by an outage it deliberately chose not to observe.
- Queue drops and close-time abandonment log at **warn**. These are losses the
  host should see. The close-time count is logged directly rather than through
  the rate-limited counter, because a rate-limited counter's final batch can go
  unreported — a real gap in the Java SDK, not worth reproducing.
- Individual retry attempts are never logged. Only the final failure is raised,
  and only a failure that never reached a status line carries an attempt count.
- Never log the API key, a response body, or anything derived from one. A proxy
  error page can echo request headers back, which is why `WireCodec.parse_response`
  raises a generic message rather than the body it failed to parse.

## 10. Testing

```shell
cd ruby
bundle install
bundle exec rake
```

`test/test_helper.rb` holds the loopback `StubServer`. It is written directly on
`TCPServer` rather than pulling in WebMock or VCR: this SDK has no test
dependencies beyond the toolchain, and a stub small enough to read in one screen
is a better guarantee than a mock framework's matching rules.

CI additionally installs the **built gem** into a throwaway `GEM_HOME` and runs
`.github/smoke/ruby/consumer.rb` against it, which is what catches a file missing
from `gemspec.files` before it reaches RubyGems.

## 11. Releasing

Tag `ruby-vX.Y.Z`. The publish workflow runs the compatibility workflow first,
builds the gem, verifies those exact bytes against the external consumer, and
pushes them without rebuilding — the same "build once, verify those bytes,
publish those bytes" shape the Java and Python releases use.

Bump `Oppex::VERSION` in `lib/oppex_sdk/version.rb` as a normal reviewed change.
The tag's version must match it; the workflow fails if it does not.

The RubyGems API key lives in the protected `rubygems` GitHub environment and is
never echoed, persisted, or passed as a command-line argument. The gemspec sets
`rubygems_mfa_required`, so a human pushing this gem by hand needs MFA; prefer
RubyGems trusted publishing over a long-lived key when it can be configured.
