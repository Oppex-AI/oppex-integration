# Oppex Rust SDK

A blocking Rust client for posting incidents to Oppex.

```text
POST https://api.oppex.ai/api/v1/incident/post
```

## Requirements

Rust 1.85 or newer (edition 2024). This SDK supports the current stable Rust
release only, and its `rust-version` floor moves forward with it.

## Install

```shell
cargo add oppex-integration-sdk
```

```toml
[dependencies]
oppex-integration-sdk = "1"
```

The crate is `oppex-integration-sdk`; the library it exposes is `oppex_sdk`.

## Usage

Create one client per application, share it across threads, and close it during
shutdown. Dropping the client closes it.

```rust
use oppex_sdk::{IncidentClient, IncidentRequest, Severity};

let client = IncidentClient::builder()
    .api_key(std::env::var("OPPEX_API_KEY")?)
    .service_key(std::env::var("OPPEX_SERVICE_KEY")?)
    .build()?;

let request = IncidentRequest::builder()
    .title("Checkout latency breached the SLO")
    .source("checkout-api")
    .severity(Severity::High)
    .details(r#"{"p99Millis":1200}"#)
    .build()?;

let response = client.post(&request)?;
println!("created {:?}", response.incident_id());
# Ok::<(), Box<dyn std::error::Error>>(())
```

`title`, `source` and `severity` are required. Every other field is optional, and
an absent optional field is left out of the payload rather than sent as null. An
optional field that is *present but blank* is rejected, because that is nearly
always a bug at the call site. `priority` defaults to 1 and `src_timestamp`
defaults to the current time in milliseconds since the Unix epoch.

The builder validates in `build()`, so a malformed incident is rejected at the
call site rather than inside a worker thread.

### Service routing

The service key is optional. A client built with only an API key posts with
`post_with_service_routing`, which omits `serviceKey` so Oppex resolves the
target service itself. The request must not carry its own service key in that
case.

A request's own `service_key` overrides the client's.

### Fire and forget

`post_async` and `post_async_with_service_routing` queue a best-effort delivery
and return immediately. The closed-client and service-key checks still run on the
calling thread, so a misuse is reported to you rather than lost in a worker. A
delivery failure after queueing is logged at debug level.

### Errors

Every failure is an `IncidentError`:

| Variant | When |
| --- | --- |
| `InvalidRequest` | the configuration or the incident failed validation; nothing was sent |
| `ClientClosed` | the post happened after `close()` |
| `Delivery` | delivery was attempted and failed |

```rust
# use oppex_sdk::IncidentError;
# fn handle(failure: IncidentError) {
if failure.status_code() == Some(401) {
    // Bad credentials, not a transient failure.
}
# }
```

`status_code()` returns `None` when the delivery never reached a status line.

### Severity

`Severity::Lowest` (1) through `Severity::Critical` (5). `Severity::value()`
returns the wire value and `Severity::from_value()` maps one back.

## Delivery behavior

- 3 second connect timeout, 5 second response timeout, 8 second attempt budget.
- HTTP 429, 500, 502, 503 and 504, plus failures that never reached a status
  line, retry after 0.5s, 1s, 2s, 4s and 8s. Every other status fails
  immediately.
- Asynchronous delivery is best effort through a queue bounded at 5000 that drops
  the oldest entry under saturation. Drops are counted and summarized at most once
  a minute.
- `close()` drains for up to 10 seconds, then abandons the rest.

None of these are configurable. They are part of the incident contract every
Oppex SDK shares, not per-caller settings.

## Logging

Internal logging goes through the [`log`](https://docs.rs/log) facade, which is a
no-op until your application installs a logger (`env_logger`, `tracing-log`, or
any other). This SDK never decides where your logs go.

## Dependencies

| Crate | Why |
| --- | --- |
| `ureq` | blocking HTTP with rustls TLS and a connection pool, and no async runtime |
| `serde_json` | response parsing and string escaping |
| `log` | logging facade; a no-op unless the host installs a logger |

There is no async runtime, and no async API. Posting an incident is a rare,
short, fire-and-forget operation, and the asynchronous path already runs on its
own worker threads.

## Build and test

```shell
cd rust
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Tests run against a loopback stub server, so the suite is network-free beyond
loopback and never reaches the real Oppex service.

## Release

Tag `rust-vX.Y.Z`. The release workflow packages the crate, verifies the packaged
bytes against an external consumer, and publishes those same bytes to crates.io.

```shell
git tag rust-v1.0.0
git push origin rust-v1.0.0
```

## License

[Apache License 2.0](LICENSE).
