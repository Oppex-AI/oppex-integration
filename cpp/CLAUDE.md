# Oppex C and C++ SDK Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file is the
durable engineering context for the C/C++ SDK directory. It records why the
project is structured as it is, which decisions are intentional, and how to
evolve it without breaking the shared incident contract, the public API, the C
ABI, or delivery semantics.

This SDK was written as a peer of the [Java SDK](../java/CLAUDE.md), which is the
reference implementation of the shared contract. Where the two intentionally
differ, the difference is listed in [section 9](#9-intentional-differences-from-the-java-sdk)
and in the README, not left for a reader to discover.

## 1. Mission

Give C++ and C applications a minimal API for posting incidents to:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

Callers should not need to understand libcurl, TLS, connection reuse, JSON
encoding, retry classification, bounded queues, or shutdown coordination.

```cpp
oppex::Client client(std::move(options));
```

Create one client per application, share it across threads, and close it (or let
it go out of scope) during application shutdown.

## 2. Two surfaces, one implementation

The SDK ships **one library** with **two headers**:

- `include/oppex/oppex.hpp` — the C++20 surface. RAII, `std::optional`,
  exceptions, a `std::function` log sink.
- `include/oppex/oppex.h` — a C ABI over the same objects. Opaque handle, POD
  structs, status codes, an error struct the caller owns by value.

`src/c_api.cpp` is the only file that bridges them, and it is a thin one: it
converts arguments, calls the C++ client, and catches everything. There is no
second implementation of validation, retry, queueing or transport, and adding one
would be the mistake this structure exists to prevent.

**Nothing may throw out of a C entry point.** Every one of them runs inside a
`Guard` that catches `IncidentError`, `std::exception` and `...`, because a C
caller has no way to handle an exception and unwinding through a C frame is
undefined. If you add an entry point, it goes through `Guard` too.

## 3. Non-negotiable constraints

- **Current toolchains only.** C++20 for the implementation, C11 for the ABI
  header. There is no older-standard compatibility floor to preserve, and no
  equivalent of the Java 7 / Python 2.7 / Node 8 gymnastics the earlier SDKs
  carry.
- **libcurl is the only external dependency.** It is linked `PRIVATE` and is not
  included by either public header, so a consumer inherits no curl include path
  and is not bound to this SDK's curl version. Adding a second dependency needs a
  reason recorded here — the reason a JSON library is not one is in §4.
- **`-Wall -Wextra -Wpedantic -Werror`**, plus `-Wconversion`, `-Wsign-conversion`,
  `-Wshadow` and `-Wold-style-cast`. This is the C/C++ equivalent of `go vet` and
  `cargo clippy -D warnings` in the sibling SDKs. Never widen a warning exception
  to make a change compile.
- **No network in tests beyond loopback.** Integration tests run against a
  `TcpListener`-based stub in `tests/test_support.hpp`.
- **The public surface is exactly the two headers.** Everything in `src/` is
  private, the library is built with hidden visibility, and the client holds a
  pimpl so the C++ header exposes no implementation type at all. Adding a
  declaration to either header is an API — and for the C header, an ABI —
  commitment.

## 4. Why the JSON reader and writer are written here

`src/json.cpp` is a complete JSON parser and a string escaper, roughly 350 lines,
and it exists instead of a dependency on nlohmann/json, RapidJSON or similar.

The trade was: this SDK sends one flat object and reads one four-field envelope.
A JSON library would double the dependency count, and for C and C++ specifically
that cost lands on every consumer's build — a second `find_package`, a second
vendored copy, or a second entry in their package manager, in an ecosystem with
no single answer for any of those.

What that decision obliges in return, and what must stay true:

- The reader is a **complete parser**, not a field scanner. The envelope can
  legitimately carry nested values this SDK ignores, and skipping them correctly
  needs real parsing.
- It has a **depth limit** (64). A hostile or broken proxy is exactly the source
  it reads from, and unbounded recursion on attacker-shaped input is a stack
  overflow, not a parse error.
- It rejects raw control characters in strings, trailing content after the
  document, and malformed escapes, and it replaces a lone surrogate with U+FFFD
  rather than emitting invalid UTF-8.
- `tests/json_test.cpp` covers each of those directly. Do not weaken a case there
  to make something else pass.

If this ever needs to parse something larger than a response envelope, revisit
the trade rather than growing the parser.

## 5. Directory ownership

```text
cpp/
├── CLAUDE.md  README.md  LICENSE
├── CMakeLists.txt                 # Build, install, and the exported package
├── cmake/oppex-sdk-config.cmake.in
├── include/oppex/
│   ├── oppex.hpp                  # The C++ surface
│   └── oppex.h                    # The C ABI
├── src/
│   ├── version.hpp                # The single source of the version; CMake reads it
│   ├── client.cpp                 # Client::Impl, and the free functions
│   ├── c_api.cpp                  # The C ABI bridge
│   ├── wire_codec.{hpp,cpp}  json.{hpp,cpp}
│   ├── retry_policy.{hpp,cpp}  interrupt.hpp
│   └── async_dispatcher.{hpp,cpp}  rate_limited_drop_logger.hpp
├── tests/                         # A tiny harness, a loopback stub, and the suite
├── examples/                      # plain.cpp and plain_c.c
└── scripts/package.sh             # Builds the release source archive
```

The version lives in exactly one place, `src/version.hpp`. `CMakeLists.txt`
parses it, so the project version and the version the library reports cannot
drift. Do not add a second copy in the CMake file.

`scripts/package.sh` defines the published file set. Keep the list in it in step
with this section: a file missing there is caught before the release, because the
smoke consumer builds the **extracted archive**, not the working tree.

## 6. Public API boundary

Supported C++ API is exactly what `oppex.hpp` declares: `Client`,
`ClientOptions`, `IncidentRequest`, `IncidentResponse`, `Severity`,
`IsValidSeverity`, `SeverityName`, `IncidentError`, `ErrorKind`, `LogLevel`,
`LogSink`, `Version`, `kDefaultEndpoint`, `kNoStatusCode`, `kMaxSourceLength`.

Supported C API is exactly what `oppex.h` declares.

Error classification is part of the contract, because callers branch on it:

| Situation | C++ | C |
| --- | --- | --- |
| Validation failed | `IncidentError` with `kInvalidRequest` | `OPPEX_ERROR_INVALID_REQUEST` |
| Post after close | `IncidentError` with `kClientClosed` | `OPPEX_ERROR_CLIENT_CLOSED` |
| Delivery failed | `IncidentError` with `kDelivery` | `OPPEX_ERROR_DELIVERY` |

Never let a libcurl result code or a parser failure escape as anything else.
`HttpTransport::Send` converts every `CURLcode` into an `IncidentError` and uses
`curl_easy_strerror`, which returns a fixed description and never anything
derived from a response body.

### C ABI compatibility

The C header is an ABI, not just an API. Within a major version:

- Do not reorder or remove a struct field, change a field's type, or change an
  enumerator's value.
- Do not change a function's signature. Add a new function instead.
- `OPPEX_ERROR_MESSAGE_CAPACITY` is part of the ABI: `oppex_error` is passed by
  value, so changing its size breaks every already-compiled caller.

Appending a field to a struct is *also* a break here, because callers allocate
these structs themselves.

## 7. Validation is a boundary concern

`wire::Normalize` validates everything and applies every default in one place, so
a synchronous and a queued post can never disagree about what was sent. Every
post calls it on the **calling thread**, before any work is queued: a malformed
incident is the caller's bug, and it must surface at the call site rather than as
a log line inside a worker.

`NormalizedRequest` is the "already validated" type the codec and transport work
against, which is how the type system distinguishes checked input from raw input.

Two rules are easy to get wrong:

- An optional field may be absent, but a present-yet-empty value is rejected.
- A scoped enum still accepts any value of its underlying type, so
  `static_cast<Severity>(99)` compiles. `IsValidSeverity` exists because of that,
  and `Normalize` calls it.

## 8. Concurrency and lifecycle

- `Client` is thread safe and intended to be shared. It owns a connection cache,
  two worker threads, and a retry policy.
- `Post` and `PostWithServiceRouting` run and retry on the calling thread.
- `PostAsync` and `PostAsyncWithServiceRouting` queue and return. The queue is
  bounded at 5000; when full the oldest queued incident is dropped so the newest
  still has a chance, and submission never blocks the application.
- Drops are counted and reported at most once a minute through the log sink.
- `Close` stops admitting posts, drains for up to 10 seconds, then abandons the
  rest. It is idempotent, `noexcept`, and safe from any thread.

Four details are deliberate:

**All dispatcher lifecycle state lives behind one mutex.** `tasks_`, `accepting_`,
`draining_` and `active_` are guarded by the same mutex the condition variable
waits on. Splitting them reintroduces the classic missed-wakeup race: a worker
reads `draining_` as true, `Close` clears it and notifies, and the worker only
afterwards starts waiting — on a notification that already happened.

**A backoff waits on a condition variable, not `sleep_for`.** `Interrupt` is this
SDK's stand-in for interrupting a sleeping thread: `Close` signals it before
draining, so a worker sitting in an 8 second backoff gives up immediately instead
of consuming the entire 10 second drain budget. The Python and Ruby SDKs solve
the same problem the same way.

**A queued task captures a `shared_ptr` to `Delivery`, not `this`.** `Close`
returns without waiting for a worker still inside an HTTP attempt — a thread
cannot be interrupted, and joining one would push `Close` past its own timeout,
exactly as Java's `close()` returns after `shutdownNow()`. The shared pointer is
what makes that safe: the transport outlives the client object if it has to.
Never change that capture to `this`.

**One libcurl easy handle per attempt, one shared connection cache per client.**
An easy handle is not thread safe and cannot be reused across threads. A `CURLSH`
share handle with a lock callback is, and it is what still gives connection, DNS
and TLS-session reuse across attempts and threads. `curl_global_init` runs once
per process through a function-local static, because it is not thread safe
either.

## 9. Intentional differences from the Java SDK

- **Two surfaces.** Java has one. The C ABI exists so plain C, and anything that
  speaks C (Python `ctypes`, Rust, Go `cgo`, LuaJIT), can use this SDK without a
  C++ toolchain.
- **RAII closes the client.** Java requires an explicit `close()` in a `finally`
  block or try-with-resources.
- **`PostAsync` throws.** Java's `postAsync` cannot fail because validation
  already happened in the request builder. There is no builder here, so
  validation happens at post time, and throwing keeps the failure at the call
  site.
- **Validation at post time, not construction.** `IncidentRequest` is an
  aggregate, which is the idiomatic way to fill a struct in C++ and leaves no
  constructor to validate in. `NormalizedRequest` carries the "checked" property
  instead.
- **No separate socket timeout.** libcurl's `CURLOPT_CONNECTTIMEOUT_MS` covers
  the 3 second connect budget and `CURLOPT_TIMEOUT_MS` bounds the whole attempt;
  there is no per-phase read timeout worth adding on top.
- **Response bodies are capped at 1 MiB** by returning short from the write
  callback, which aborts the transfer rather than merely checking the size after
  the fact.
- **`Expect: 100-continue` is disabled.** libcurl adds it for larger bodies, and
  it costs a round trip against servers that never answer it.
- **A `std::function` log sink rather than a logging framework.** C++ has no
  standard logging facade, and picking one would impose it on every consumer.

## 10. Logging rules

- Everything goes through `ClientOptions::log_sink`. Omitting it discards every
  message, so the SDK never writes anywhere the host did not ask for. The sink is
  invoked from worker threads, which the header says explicitly.
- Queued delivery failures log at **debug**, matching Java's `Level.FINE` choice:
  an application that fires and forgets should not have its logs flooded by an
  outage it deliberately chose not to observe.
- Queue drops and close-time abandonment log at **warning**. These are losses the
  host should see. The close-time count is reported directly rather than through
  the rate-limited counter, because a rate-limited counter's final batch can go
  unreported — a real gap in the Java SDK, not worth reproducing.
- Individual retry attempts are never logged. Only the final failure is thrown,
  and only a failure that never reached a status line carries an attempt count.
- Never log the API key, a response body, or anything derived from one. A proxy
  error page can echo request headers back, which is why `wire::ParseResponse`
  throws a generic message rather than the body it failed to parse.

## 11. Testing

```shell
cd cpp
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
```

`tests/test_support.hpp` holds a harness of about a hundred lines and a loopback
stub server. Both are written here rather than pulled in, for the same reason as
the JSON code: a test framework is another dependency every contributor's build
has to resolve, and a harness small enough to read in one screen is a better
guarantee than a framework's own configuration surface.

`tests/c_api_test.c` is compiled **as C**, not C++. That is its whole point: it
proves `oppex.h` is valid C and that the ABI is usable without a C++ compiler,
which no test written in C++ can prove. `tests/c_api_bridge.cpp` runs it as one
case in the same suite, so a C ABI regression shows up in the same run.

`OPPEX_ASSERT_EQ` copies its operands rather than binding references to them.
This is not incidental: the arguments are very often `optional.value()`, whose
referent dies with the temporary the expression produced, and the reference
version of this macro was a real dangling read the compiler caught.

CI additionally builds `.github/smoke/cpp/` against the **extracted release
archive**, which is what catches a file missing from `scripts/package.sh` before
it reaches a release.

## 12. Releasing

There is no canonical C or C++ package registry, so the published artifact is a
source archive attached to a GitHub Release, plus its SHA-256. Conan and vcpkg
were both considered and deliberately deferred: each needs a registry PR or a
hosted remote to be useful, and neither is a prerequisite for a consumer who can
already run `find_package(oppex-sdk)` after `cmake --install`.

Tag `cpp-vX.Y.Z`. The publish workflow runs the compatibility workflow first,
builds the archive with `scripts/package.sh`, verifies those exact bytes by
building the external consumer against the extracted copy, and attaches the same
file without rebuilding — the same "build once, verify those bytes, publish those
bytes" shape the Java and Python releases use.

Bump `OPPEX_SDK_VERSION` in `src/version.hpp` as a normal reviewed change. The
tag's version must match it; the workflow fails if it does not.

A release that changes anything listed under **C ABI compatibility** in §6 is a
major version, not a minor one.
