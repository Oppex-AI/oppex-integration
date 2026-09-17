// Posts one incident and waits for the result, then queues one more.
//
//   OPPEX_API_KEY=... OPPEX_SERVICE_KEY=... dotnet run --project examples/Plain

using Oppex.Integration.Sdk;

// Disposing drains queued incidents for up to ten seconds.
await using var client = new IncidentClient(new IncidentClientOptions
{
    ApiKey = Environment.GetEnvironmentVariable("OPPEX_API_KEY")
             ?? throw new InvalidOperationException("OPPEX_API_KEY is not set"),
    ServiceKey = Environment.GetEnvironmentVariable("OPPEX_SERVICE_KEY"),
});

var response = await client.PostAsync(new IncidentRequest
{
    Title = "Checkout latency breached the SLO",
    Source = "checkout-api",
    Severity = Severity.High,
    Priority = 2,
    Component = "payments",
    Group = "platform",
    Type = "latency",
    Details = """{"p99Millis":1200,"threshold":800}""",
});

Console.WriteLine($"incident {response.IncidentId} created (code {response.Code})");

// Fire and forget. Validation still fails fast here; a delivery failure after
// this point is logged rather than thrown.
client.Enqueue(new IncidentRequest
{
    Title = "Background job queue is backing up",
    Source = "worker",
    Severity = Severity.Low,
});
