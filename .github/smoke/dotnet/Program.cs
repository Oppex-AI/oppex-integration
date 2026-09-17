// Exercises the published .NET SDK surface from outside its own project,
// mirroring .github/smoke/java/ExternalConsumer.java: only supported API,
// resolved from the packed .nupkg rather than a project reference, network-free,
// and a fixed sentinel the workflow greps for.
//
// "Network-free" does not mean "never attempts an HTTP call". Port 1 on loopback
// refuses the connection immediately, so a fully valid request pointed at it
// still reaches the real transport and fails there, genuinely exercising that
// path without touching the actual Oppex service.

using System.Reflection;
using Oppex.Integration.Sdk;

if (IncidentClient.DefaultEndpoint != "https://api.oppex.ai/api/v1/incident/post")
{
    throw new InvalidOperationException($"unexpected endpoint {IncidentClient.DefaultEndpoint}");
}

if ((int)Severity.Medium != 3)
{
    throw new InvalidOperationException("unexpected severity mapping");
}

await CheckRealTransportFailureAsync();
await CheckValidationAsync();
await CheckServiceRoutingAsync();

var sdkVersion = typeof(IncidentClient).Assembly
    .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";
Console.WriteLine($"EXTERNAL_CONSUMER_OK dotnet={Environment.Version} sdk={sdkVersion}");

// Reaches the actual transport and requires it to fail with a connection
// refusal, not a validation error.
static async Task CheckRealTransportFailureAsync()
{
    Environment.SetEnvironmentVariable("OPPEX_TEST_ENDPOINT_URL", "http://127.0.0.1:1");
    try
    {
        await using var client = new IncidentClient(new IncidentClientOptions
        {
            ApiKey = "wrong-api-key",
            ServiceKey = "wrong-service-key",
        });

        var failure = await Assert.ThrowsAsync<IncidentException>(() => client.PostAsync(new IncidentRequest
        {
            Title = "valid title",
            Source = "github-actions",
            Severity = Severity.Medium,
        }));

        if (failure.HasHttpStatus)
        {
            throw new InvalidOperationException("a refused connection must carry no HTTP status");
        }

        // Five retries plus the first attempt, so the message carries the count.
        if (!failure.Message.Contains("attempts", StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"an exhausted network failure must report its attempts: {failure.Message}");
        }
    }
    finally
    {
        Environment.SetEnvironmentVariable("OPPEX_TEST_ENDPOINT_URL", null);
    }
}

static async Task CheckValidationAsync()
{
    await using var client = new IncidentClient(new IncidentClientOptions
    {
        ApiKey = "external-consumer-api-key",
        ServiceKey = "external-consumer-service-key",
    });

    // A blank title fails before any HTTP attempt.
    await Assert.ThrowsAsync<ArgumentException>(() => client.PostAsync(new IncidentRequest
    {
        Title = "  ",
        Source = "github-actions",
        Severity = Severity.Medium,
    }));

    var request = new IncidentRequest
    {
        Title = "Closed client test",
        Source = "github-actions",
        Severity = Severity.Low,
    };
    await client.DisposeAsync();
    await Assert.ThrowsAsync<ObjectDisposedException>(() => client.PostAsync(request));
}

// The precondition fails before any network call.
static async Task CheckServiceRoutingAsync()
{
    await using var client = new IncidentClient(new IncidentClientOptions
    {
        ApiKey = "external-consumer-api-key",
    });

    await Assert.ThrowsAsync<ArgumentException>(() => client.PostWithServiceRoutingAsync(new IncidentRequest
    {
        Title = "Service routing test",
        Source = "github-actions",
        Severity = Severity.Low,
        ServiceKey = "external-consumer-service-key",
    }));
}

/// <summary>
/// A two-method stand-in for a test framework. This project deliberately takes no
/// dependency beyond the package under test, so a restore failure here can only
/// mean that package is wrong.
/// </summary>
internal static class Assert
{
    internal static async Task<TException> ThrowsAsync<TException>(Func<Task> action)
        where TException : Exception
    {
        try
        {
            await action();
        }
        catch (TException expected)
        {
            return expected;
        }

        throw new InvalidOperationException($"expected {typeof(TException).Name}, but nothing was thrown");
    }
}
