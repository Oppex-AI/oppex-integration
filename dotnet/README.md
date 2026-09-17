# Oppex .NET SDK

A .NET client for posting incidents to Oppex.

```text
POST https://api.oppex.ai/api/v1/incident/post
```

## Requirements

.NET 10 or newer. This SDK targets the current stable .NET release only, and its
target framework moves forward with it. The only dependency is
`Microsoft.Extensions.Logging.Abstractions`.

## Install

```shell
dotnet add package Oppex.Integration.Sdk
```

## Usage

Create one client per application, share it across threads, and dispose it during
shutdown.

```csharp
using Oppex.Integration.Sdk;

await using var client = new IncidentClient(new IncidentClientOptions
{
    ApiKey = Environment.GetEnvironmentVariable("OPPEX_API_KEY")!,
    ServiceKey = Environment.GetEnvironmentVariable("OPPEX_SERVICE_KEY"),
});

var response = await client.PostAsync(new IncidentRequest
{
    Title = "Checkout latency breached the SLO",
    Source = "checkout-api",
    Severity = Severity.High,
    Details = """{"p99Millis":1200}""",
});

Console.WriteLine(response.IncidentId);
```

`Title`, `Source` and `Severity` are required. Every other property is optional,
and an absent optional property is left out of the payload rather than sent as
null. A property that is *present but blank* is rejected, because that is nearly
always a bug at the call site. `Priority` defaults to 1 and `SrcTimestamp`
defaults to the current time in milliseconds since the Unix epoch.

`IncidentRequest` is a record, so a caller can derive one request from another
with `with`.

### Service routing

The service key is optional. A client built with only an `ApiKey` posts with
`PostWithServiceRoutingAsync`, which omits `serviceKey` so Oppex resolves the
target service itself. The request must not carry its own service key in that
case.

A request's own `ServiceKey` overrides the client's.

### Fire and forget

`Enqueue` and `EnqueueWithServiceRouting` queue a best-effort delivery and return
immediately. They are deliberately *not* named `PostAsync`: in .NET that suffix
promises an awaitable, and these are not. Validation and the disposed check still
run on the calling thread, so a misuse is thrown to you rather than lost in a
worker. A delivery failure after queueing is logged at debug level.

```csharp
client.Enqueue(request);
```

### Errors

| Situation | Thrown |
| --- | --- |
| Invalid options or request | `ArgumentException` |
| Any post after disposal | `ObjectDisposedException` |
| Delivery failure | `IncidentException` |

```csharp
try
{
    await client.PostAsync(request);
}
catch (IncidentException failure) when (failure.StatusCode == 401)
{
    // Bad credentials, not a transient failure.
}
```

`IncidentException.StatusCode` is `IncidentException.NoStatusCode` (-1) when the
delivery never reached a status line; `HasHttpStatus` answers that directly.

### Severity

`Severity.Lowest` (1) through `Severity.Critical` (5). The enum values are the
wire values, so casting to `int` is the conversion.

### Logging

Pass any `ILogger` as `IncidentClientOptions.Logger`:

```csharp
new IncidentClientOptions { ApiKey = key, Logger = loggerFactory.CreateLogger<IncidentClient>() }
```

The default is `NullLogger.Instance`, so the SDK never writes anywhere the host
did not ask for.

## Delivery behavior

- 3 second connect timeout, 5 second response timeout, 8 second attempt budget.
- HTTP 429, 500, 502, 503 and 504, plus failures that never reached a status
  line, retry after 0.5s, 1s, 2s, 4s and 8s. Every other status fails
  immediately.
- Queued delivery is best effort through a channel bounded at 5000 that drops the
  oldest entry under saturation. Drops are counted and summarized at most once a
  minute.
- Disposal drains for up to 10 seconds, then cancels whatever is still running.

None of these are configurable. They are part of the incident contract every
Oppex SDK shares, not per-caller settings.

## Trimming and native AOT

The assembly is marked `IsAotCompatible`. JSON is written and read through
`Utf8JsonWriter` and `JsonDocument`, and logging goes through source-generated
`LoggerMessage` delegates, so nothing here uses reflection or dynamic code. A
consumer can trim or publish ahead-of-time without this SDK being the reason they
cannot.

## Build and test

```shell
cd dotnet
dotnet build Oppex.Integration.Sdk.slnx -c Release
dotnet test  Oppex.Integration.Sdk.slnx -c Release
```

Warnings are errors, and the .NET analyzers run as part of the build. Integration
tests run against a loopback `HttpListener`, so the suite is network-free beyond
loopback and never reaches the real Oppex service.

## Release

Tag `dotnet-vX.Y.Z`. The release workflow packs the library, verifies that exact
`.nupkg` against an external consumer, and pushes the same file to NuGet without
rebuilding.

```shell
git tag dotnet-v1.0.0
git push origin dotnet-v1.0.0
```

The tag's version must match `<Version>` in the csproj; the workflow fails if it
does not.

## License

[Apache License 2.0](LICENSE).
