# Oppex Ruby SDK

A dependency-free Ruby client for posting incidents to Oppex.

```text
POST https://api.oppex.ai/api/v1/incident/post
```

## Requirements

Ruby 3.2 or newer. This SDK supports the current stable Ruby release only, and
its `required_ruby_version` floor moves forward with it. The standard library is
the only dependency.

## Install

```shell
gem install oppex_sdk
```

```ruby
gem "oppex_sdk", "~> 1.0"
```

## Usage

Create one client per application, share it across threads, and close it during
shutdown.

```ruby
require "oppex_sdk"

client = Oppex::IncidentClient.new(
  api_key: ENV.fetch("OPPEX_API_KEY"),
  service_key: ENV.fetch("OPPEX_SERVICE_KEY")
)

response = client.post(
  Oppex::IncidentRequest.new(
    title: "Checkout latency breached the SLO",
    source: "checkout-api",
    severity: Oppex::Severity::HIGH,
    details: JSON.generate({ p99Millis: 1200 })
  )
)
puts response.incident_id

client.close
```

`IncidentClient.open` closes the client for you, even if the block raises:

```ruby
Oppex::IncidentClient.open(api_key: ENV.fetch("OPPEX_API_KEY")) do |client|
  client.post_with_service_routing(request)
end
```

`title`, `source` and `severity` are required. Every other field is optional, and
an absent optional field is left out of the payload rather than sent as null. An
optional field that is *present but blank* is rejected, because that is nearly
always a bug at the call site. `priority` defaults to 1 and `src_timestamp`
defaults to the current time in milliseconds since the Unix epoch.

`IncidentRequest` validates in its constructor and freezes itself, so a malformed
incident is rejected at the call site rather than inside a worker thread.

### Service routing

The service key is optional. A client built with only an `api_key` posts with
`post_with_service_routing`, which omits `serviceKey` so Oppex resolves the
target service itself. The request must not carry its own service key in that
case.

A request's own `service_key` overrides the client's.

### Fire and forget

`post_async` and `post_async_with_service_routing` queue a best-effort delivery
and return immediately. The closed-client and service-key checks still run on the
calling thread, so a misuse is raised to you rather than lost in a worker. A
delivery failure after queueing is logged at debug level.

### Errors

| Situation | Raised |
| --- | --- |
| Invalid argument value | `ArgumentError` |
| Argument of the wrong type | `TypeError` |
| Any post after `close` | `Oppex::ClientClosedError` |
| Delivery failure | `Oppex::IncidentError` |

`Oppex::ClientClosedError` and `Oppex::IncidentError` both descend from
`Oppex::Error`, so one `rescue` catches everything this SDK raises on its own.

```ruby
begin
  client.post(request)
rescue Oppex::IncidentError => e
  retry_later if e.retryable?
  logger.error("oppex rejected the incident: HTTP #{e.status_code}") if e.http_status?
end
```

`IncidentError#status_code` is `-1` when the delivery never reached a status
line; `#http_status?` answers that directly.

### Severity

`Oppex::Severity::LOWEST` (1) through `Oppex::Severity::CRITICAL` (5). The
constants are the wire values, so an integer from another system can be passed
straight through after `Oppex::Severity.validate!`.

### Logging

Pass any object that responds to `debug`, `info`, `warn` and `error`:

```ruby
Oppex::IncidentClient.new(api_key: key, logger: Rails.logger)
```

The default writes to standard error. This SDK deliberately does not require the
`logger` standard library, which stops being a default gem in Ruby 4.0 — duck
typing keeps the gem dependency-free and accepts your logger either way.

## Delivery behavior

- 3 second open timeout, 5 second read and write timeouts.
- HTTP 429, 500, 502, 503 and 504, plus failures that never reached a status
  line, retry after 0.5s, 1s, 2s, 4s and 8s. Every other status fails
  immediately.
- Asynchronous delivery is best effort through a queue bounded at 5000 that drops
  the oldest entry under saturation. Drops are counted and summarized at most once
  a minute.
- `close` drains for up to 10 seconds, then abandons the rest.

None of these are configurable. They are part of the incident contract every
Oppex SDK shares, not per-caller settings.

## Build and test

```shell
cd ruby
bundle install
bundle exec rake        # rubocop, then the minitest suite
```

Tests run against a loopback stub server, so the suite is network-free beyond
loopback and never reaches the real Oppex service.

## Release

Tag `ruby-vX.Y.Z`. The release workflow builds the gem, verifies those exact
bytes against an external consumer, and pushes them to RubyGems without
rebuilding.

```shell
git tag ruby-v1.0.0
git push origin ruby-v1.0.0
```

The tag's version must match `Oppex::VERSION`; the workflow fails if it does not.

## License

[Apache License 2.0](LICENSE).
