# Oppex C and C++ SDK

A C++20 client for posting incidents to Oppex, with a C ABI over the same
implementation.

```text
POST https://api.oppex.ai/api/v1/incident/post
```

## Requirements

- A C++20 compiler (GCC 12+, Clang 15+, MSVC 19.34+) and CMake 3.20 or newer.
- libcurl with TLS support. The public headers do not include it, so it is a
  build and link dependency only.

This SDK targets current toolchains only; there is no older-standard
compatibility floor to preserve.

## Build and install

```shell
cd cpp
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
cmake --install build --prefix /usr/local
```

Then, from a consuming project:

```cmake
find_package(oppex-sdk REQUIRED)
target_link_libraries(my_app PRIVATE oppex::sdk)
```

Options: `-DOPPEX_BUILD_TESTS=OFF` and `-DOPPEX_BUILD_EXAMPLES=OFF`. Both default
to on for a top-level build and off when this directory is added as a
subdirectory.

## C++ usage

Create one client per application, share it across threads, and let it go out of
scope during shutdown; the destructor closes.

```cpp
#include <oppex/oppex.hpp>

oppex::ClientOptions options;
options.api_key = "api-key";
options.service_key = "service-key";
oppex::Client client(std::move(options));

oppex::IncidentRequest request;
request.title = "Checkout latency breached the SLO";
request.source = "checkout-api";
request.severity = oppex::Severity::kHigh;
request.details = R"({"p99Millis":1200})";

const oppex::IncidentResponse response = client.Post(request);
```

`title`, `source` and `severity` are required. Every other field is optional, and
an absent optional field is left out of the payload rather than sent as null. An
optional field that is *present but empty* is rejected, because that is nearly
always a bug at the call site. `priority` defaults to 1 when zero, and
`src_timestamp` defaults to the current time in milliseconds since the Unix
epoch when zero.

### Service routing

The service key is optional. A client built with only an API key posts with
`PostWithServiceRouting`, which omits `serviceKey` so Oppex resolves the target
service itself. The request must not carry its own service key in that case.

A request's own `service_key` overrides the client's.

### Fire and forget

`PostAsync` and `PostAsyncWithServiceRouting` queue a best-effort delivery and
return immediately. Validation, the closed check and the service-key check all
still run on the calling thread and throw, so a misuse reaches you rather than a
log line inside a worker. A delivery failure after queueing is logged at debug
level.

### Errors

Every failure is an `oppex::IncidentError`, whose `kind()` says which:

| Kind | When |
| --- | --- |
| `ErrorKind::kInvalidRequest` | the options or the incident failed validation; nothing was sent |
| `ErrorKind::kClientClosed` | the post happened after `Close()` |
| `ErrorKind::kDelivery` | delivery was attempted and failed |

```cpp
try {
  client.Post(request);
} catch (const oppex::IncidentError& failure) {
  if (failure.status_code() == 401) { /* bad credentials, not transient */ }
}
```

`status_code()` is `oppex::kNoStatusCode` (-1) when the delivery never reached a
status line; `has_http_status()` answers that directly.

### Logging

Set `ClientOptions::log_sink` to any callable taking `(LogLevel, std::string_view)`.
It is invoked from worker threads as well as the caller's, so it must be thread
safe. Omitting it discards every message, so the SDK never writes anywhere the
host did not ask for.

## C usage

```c
#include <oppex/oppex.h>

oppex_error error;
oppex_client_options options = {0};
options.api_key = "api-key";
options.service_key = "service-key";

oppex_client* client = oppex_client_create(&options, &error);
if (client == NULL) { /* error.message says why */ }

oppex_incident_request request = {0};
request.title = "Checkout latency breached the SLO";
request.source = "checkout-api";
request.severity = OPPEX_SEVERITY_HIGH;

oppex_incident_response response = {0};
if (oppex_client_post(client, &request, &response, &error) == OPPEX_OK) {
    printf("%s\n", response.incident_id ? response.incident_id : "(none)");
}
oppex_incident_response_free(&response);
oppex_client_destroy(client);
```

Nothing in the C ABI throws. Each call reports through its `oppex_status` return
value and fills an `oppex_error` the caller owns by value, so there is no error
object to free. `oppex_incident_response`'s two strings are heap-allocated and
released by `oppex_incident_response_free`.

Every `const char*` in the options and the request is copied when the call is
made, so the caller may free or reuse its own buffers immediately afterwards.

## Delivery behavior

- 3 second connect timeout, 8 second attempt budget.
- HTTP 429, 500, 502, 503 and 504, plus failures that never reached a status
  line, retry after 0.5s, 1s, 2s, 4s and 8s. Every other status fails
  immediately.
- Queued delivery is best effort through a queue bounded at 5000 that drops the
  oldest entry under saturation. Drops are counted and summarized at most once a
  minute.
- Closing drains for up to 10 seconds, then abandons the rest.

None of these are configurable. They are part of the incident contract every
Oppex SDK shares, not per-caller settings.

## Release

There is no canonical C or C++ package registry, so a release is a source
archive attached to a GitHub Release. Tag `cpp-vX.Y.Z`; the workflow builds the
archive, verifies those exact bytes by building an external consumer against
them, and attaches the same file with its SHA-256.

```shell
./scripts/package.sh          # writes cpp/dist/oppex-integration-sdk-cpp-X.Y.Z.tar.gz
git tag cpp-v1.0.0
git push origin cpp-v1.0.0
```

The tag's version must match `OPPEX_SDK_VERSION` in `src/version.hpp`; the
workflow fails if it does not.

## License

[Apache License 2.0](LICENSE).
