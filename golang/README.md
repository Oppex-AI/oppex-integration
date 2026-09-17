# Oppex Go SDK

A dependency-free Go client for posting incidents to Oppex.

```text
POST https://api.oppex.ai/api/v1/incident/post
```

## Requirements

Go 1.27 or newer. This SDK supports the current stable Go release only, and its
compatibility floor moves forward with it. The standard library is the only
dependency.

## Install

```shell
go get github.com/Oppex-AI/oppex-integration/golang@latest
```

```go
import "github.com/Oppex-AI/oppex-integration/golang/oppex"
```

## Usage

Create one client per application, share it across goroutines, and close it during
shutdown.

```go
client, err := oppex.New(oppex.Config{
    APIKey:     os.Getenv("OPPEX_API_KEY"),
    ServiceKey: os.Getenv("OPPEX_SERVICE_KEY"),
})
if err != nil {
    return err
}
defer client.Close()

response, err := client.Post(ctx, oppex.IncidentRequest{
    Title:    "Checkout latency breached the SLO",
    Source:   "checkout-api",
    Severity: oppex.SeverityHigh,
    Details:  `{"p99Millis":1200}`,
})
```

`Title`, `Source` and `Severity` are required. Every other field is optional, and
an absent optional field is left out of the payload rather than sent as null.
`Priority` defaults to 1 and `SrcTimestamp` defaults to the current time in
milliseconds since the Unix epoch.

### Service routing

The service key is optional. A client built with only an API key posts with
`PostWithServiceRouting`, which omits `serviceKey` so Oppex resolves the target
service itself. The request must not carry its own service key in that case.

```go
client, err := oppex.New(oppex.Config{APIKey: os.Getenv("OPPEX_API_KEY")})
// ...
response, err := client.PostWithServiceRouting(ctx, request)
```

A request's own `ServiceKey` overrides the client's.

### Fire and forget

`PostAsync` and `PostAsyncWithServiceRouting` queue a best-effort delivery and
return immediately. Validation and the closed-client check still run on the
calling goroutine, so a malformed incident is reported to you rather than lost in
a worker. A delivery failure after queueing is logged at debug level.

```go
if err := client.PostAsync(request); err != nil {
    // The incident was never queued: invalid input, or the client is closed.
}
```

### Errors

| Situation | Result |
| --- | --- |
| Invalid configuration or incident | an error wrapping `oppex.ErrInvalidRequest` |
| Any post after `Close` | `oppex.ErrClientClosed` |
| Delivery failure | an `*oppex.IncidentError` |

```go
var failure *oppex.IncidentError
if errors.As(err, &failure) && failure.StatusCode == http.StatusUnauthorized {
    // ...
}
```

`IncidentError.StatusCode` is `oppex.NoStatusCode` (-1) when the delivery never
reached a status line.

### Severity

`SeverityLowest` (1), `SeverityLow` (2), `SeverityMedium` (3), `SeverityHigh` (4)
and `SeverityCritical` (5). The constants are the wire values.

## Delivery behavior

- 3 second connect timeout, 5 second response-header timeout.
- HTTP 429, 500, 502, 503 and 504, plus failures that never reached a status
  line, retry after 0.5s, 1s, 2s, 4s and 8s. Every other status fails
  immediately.
- Asynchronous delivery is best effort through a queue bounded at 5000 that drops
  the oldest entry under saturation. Drops are counted and summarized at most once
  a minute.
- `Close` drains for up to 10 seconds, then cancels whatever is still running.

None of these are configurable. They are part of the incident contract every
Oppex SDK shares, not per-caller settings.

## Logging

Internal logging goes to `slog.Default()`, or to the `*slog.Logger` you pass as
`Config.Logger`.

## Build and test

```shell
cd golang
go build ./...
go vet ./...
go test -race ./...
```

## Release

The Go module proxy serves this module straight from the repository, so there is
no artifact to publish and no release job. A release is a tag.

Because the module lives in the `golang/` subdirectory, its tags **must** carry
that directory prefix — `golang/v1.0.0`, not `go-v1.0.0`. The proxy will not
resolve a subdirectory module from an unprefixed tag.

```shell
git tag golang/v1.0.0
git push origin golang/v1.0.0
```

## License

[Apache License 2.0](LICENSE).
