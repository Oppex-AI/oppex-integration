using System.Text.Json;

namespace Oppex.Integration.Sdk.Tests;

/// <summary>
/// The endpoint seam is an environment variable rather than a client option, so
/// the public surface never grows a knob that exists only to ease testing. That
/// makes these tests process-global, so they run one at a time.
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class SerialEndpointEnvironment
{
    internal const string Name = "endpoint-environment";
}

[Collection(SerialEndpointEnvironment.Name)]
public class IncidentClientTests : IDisposable
{
    private const string Created = """{"success":true,"code":200,"message":"created","data":"INC-42"}""";

    private static readonly TimeSpan[] FastDelays =
        [.. Enumerable.Repeat(TimeSpan.FromMilliseconds(1), 5)];

    private readonly List<StubServer> _servers = [];

    public void Dispose()
    {
        foreach (var server in _servers)
        {
            server.Dispose();
        }

        Environment.SetEnvironmentVariable("OPPEX_TEST_ENDPOINT_URL", null);
        GC.SuppressFinalize(this);
    }

    private StubServer StartServer(params (int Status, string Body)[] responses)
    {
        var server = new StubServer(responses.Length == 0 ? [(200, Created)] : responses);
        _servers.Add(server);
        Environment.SetEnvironmentVariable("OPPEX_TEST_ENDPOINT_URL", server.Url);
        return server;
    }

    private static IncidentClient Client(string? serviceKey = "client-service-key") =>
        new(new IncidentClientOptions { ApiKey = "api-key", ServiceKey = serviceKey },
            TimeProvider.System, FastDelays);

    private static IncidentRequest Request() => new()
    {
        Title = "Checkout latency",
        Source = "checkout-api",
        Severity = Severity.High,
        SrcTimestamp = 1_700_000_000_000,
    };

    [Fact]
    public void ABlankApiKeyIsRejected()
    {
        Assert.Throws<ArgumentException>(() => new IncidentClient(new IncidentClientOptions { ApiKey = "   " }));
        Assert.Throws<ArgumentException>(() => new IncidentClient(new IncidentClientOptions { ApiKey = "" }));
    }

    [Fact]
    public async Task PostReturnsTheParsedResponse()
    {
        StartServer();
        await using var client = Client();

        var response = await client.PostAsync(Request(), TestContext.Current.CancellationToken);

        Assert.True(response.Successful);
        Assert.Equal("INC-42", response.IncidentId);
        Assert.Equal("created", response.Message);
    }

    [Fact]
    public async Task PostSendsTheAgreedHeaders()
    {
        var server = StartServer();
        await using var client = Client();

        await client.PostAsync(Request(), TestContext.Current.CancellationToken);
        var sent = server.NextRequest();

        Assert.Equal("api-key", sent.Header("X-API-KEY"));
        Assert.Equal("application/json; charset=utf-8", sent.Header("Content-Type"));
        Assert.Equal("application/json", sent.Header("Accept"));
    }

    [Fact]
    public async Task PostSendsTheAgreedPayload()
    {
        var server = StartServer();
        await using var client = Client();

        await client.PostAsync(Request(), TestContext.Current.CancellationToken);
        var payload = server.NextRequest().Payload();

        Assert.Equal("client-service-key", payload.GetProperty("serviceKey").GetString());
        Assert.Equal("Checkout latency", payload.GetProperty("title").GetString());
        Assert.Equal(4, payload.GetProperty("severity").GetInt32());
        Assert.Equal(1, payload.GetProperty("priority").GetInt32());
        Assert.Equal(1_700_000_000_000, payload.GetProperty("srcTimestamp").GetInt64());
        Assert.False(payload.TryGetProperty("component", out _), "an absent optional field must be omitted");
    }

    [Fact]
    public async Task ARequestServiceKeyOverridesTheClients()
    {
        var server = StartServer();
        await using var client = Client();

        await client.PostAsync(
            Request() with { ServiceKey = "request-service-key" }, TestContext.Current.CancellationToken);

        Assert.Equal("request-service-key", server.NextRequest().Payload().GetProperty("serviceKey").GetString());
    }

    [Fact]
    public async Task AServiceKeyIsRequiredSomewhere()
    {
        var server = StartServer();
        await using var client = Client(serviceKey: null);

        await Assert.ThrowsAsync<ArgumentException>(
            () => client.PostAsync(Request(), TestContext.Current.CancellationToken));
        Assert.Equal(0, server.RequestCount);
    }

    [Fact]
    public async Task ServiceRoutingOmitsTheServiceKey()
    {
        var server = StartServer();
        await using var client = Client();

        await client.PostWithServiceRoutingAsync(Request(), TestContext.Current.CancellationToken);

        Assert.False(
            server.NextRequest().Payload().TryGetProperty("serviceKey", out _),
            "service routing must omit serviceKey entirely");
    }

    [Fact]
    public async Task ServiceRoutingRefusesARequestServiceKey()
    {
        var server = StartServer();
        await using var client = Client(serviceKey: null);

        await Assert.ThrowsAsync<ArgumentException>(() => client.PostWithServiceRoutingAsync(
            Request() with { ServiceKey = "request-service-key" }, TestContext.Current.CancellationToken));
        Assert.Equal(0, server.RequestCount);
    }

    [Fact]
    public async Task ARetryableStatusIsRetried()
    {
        var server = StartServer((503, ""), (503, ""), (200, Created));
        await using var client = Client();

        var response = await client.PostAsync(Request(), TestContext.Current.CancellationToken);

        Assert.True(response.Successful);
        for (var attempt = 0; attempt < 3; attempt++)
        {
            server.NextRequest();
        }

        server.AssertNoFurtherRequest();
    }

    [Fact]
    public async Task ANonRetryableStatusFailsImmediately()
    {
        var server = StartServer((401, """{"success":false,"message":"invalid api key"}"""));
        await using var client = Client();

        var failure = await Assert.ThrowsAsync<IncidentException>(
            () => client.PostAsync(Request(), TestContext.Current.CancellationToken));

        Assert.Equal(401, failure.StatusCode);
        Assert.False(failure.Retryable);
        Assert.Contains("invalid api key", failure.Message, StringComparison.Ordinal);

        server.NextRequest();
        server.AssertNoFurtherRequest();
    }

    [Fact]
    public async Task EnqueueDeliversAndValidatesOnTheCallingThread()
    {
        var server = StartServer();
        await using var invalid = Client(serviceKey: null);

        Assert.Throws<ArgumentException>(() => invalid.Enqueue(Request()));

        await using var client = Client();
        client.Enqueue(Request());

        Assert.Equal("client-service-key", server.NextRequest().Payload().GetProperty("serviceKey").GetString());
    }

    [Fact]
    public async Task EveryPostFailsOnADisposedClient()
    {
        var server = StartServer();
        var client = Client();
        await client.DisposeAsync();
        await client.DisposeAsync();

        await Assert.ThrowsAsync<ObjectDisposedException>(
            () => client.PostAsync(Request(), TestContext.Current.CancellationToken));
        await Assert.ThrowsAsync<ObjectDisposedException>(
            () => client.PostWithServiceRoutingAsync(Request(), TestContext.Current.CancellationToken));
        Assert.Throws<ObjectDisposedException>(() => client.Enqueue(Request()));
        Assert.Equal(0, server.RequestCount);
    }

    [Fact]
    public async Task TheClientIsSafeForConcurrentUse()
    {
        var server = StartServer();
        await using var client = Client();

        await Task.WhenAll(Enumerable.Range(0, 16).Select(
            _ => client.PostAsync(Request(), TestContext.Current.CancellationToken)));

        for (var delivered = 0; delivered < 16; delivered++)
        {
            server.NextRequest();
        }
    }
}
