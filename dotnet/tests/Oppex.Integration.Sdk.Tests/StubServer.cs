using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;

namespace Oppex.Integration.Sdk.Tests;

/// <summary>
/// A loopback stand-in for the Oppex API. Tests never reach the real service;
/// only the local listener started here.
/// </summary>
internal sealed class StubServer : IDisposable
{
    private readonly HttpListener _listener = new();
    private readonly ConcurrentQueue<RecordedRequest> _requests = new();
    private readonly (int Status, string Body)[] _responses;
    private readonly CancellationTokenSource _stopping = new();
    private int _served;

    /// <summary>
    /// <paramref name="responses"/> is consumed one entry per request; the last
    /// entry repeats once the list runs out, so a test only lists the attempts it
    /// cares about.
    /// </summary>
    internal StubServer(params (int Status, string Body)[] responses)
    {
        _responses = responses;
        var port = FindFreePort();
        Url = $"http://127.0.0.1:{port}/incident/";
        _listener.Prefixes.Add(Url);
        _listener.Start();
        _ = Task.Run(AcceptLoopAsync);
    }

    internal string Url { get; }

    internal int RequestCount => _requests.Count;

    internal RecordedRequest NextRequest(TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(10));
        while (DateTime.UtcNow < deadline)
        {
            if (_requests.TryDequeue(out var request))
            {
                return request;
            }

            Thread.Sleep(10);
        }

        throw new InvalidOperationException("the client never sent a request");
    }

    internal void AssertNoFurtherRequest()
    {
        Thread.Sleep(250);
        if (!_requests.IsEmpty)
        {
            throw new InvalidOperationException("the client sent more requests than expected");
        }
    }

    private async Task AcceptLoopAsync()
    {
        while (!_stopping.IsCancellationRequested)
        {
            HttpListenerContext context;
            try
            {
                context = await _listener.GetContextAsync().ConfigureAwait(false);
            }
            catch (Exception failure) when (failure is HttpListenerException or ObjectDisposedException)
            {
                return;
            }

            var index = Math.Min(Interlocked.Increment(ref _served) - 1, _responses.Length - 1);
            var (status, body) = _responses[index];

            using var reader = new StreamReader(context.Request.InputStream, Encoding.UTF8);
            var payload = await reader.ReadToEndAsync().ConfigureAwait(false);
            _requests.Enqueue(new RecordedRequest(
                context.Request.Headers.AllKeys
                    .Where(key => key is not null)
                    .ToDictionary(key => key!, key => context.Request.Headers[key] ?? string.Empty,
                        StringComparer.OrdinalIgnoreCase),
                payload));

            var bytes = Encoding.UTF8.GetBytes(body);
            context.Response.StatusCode = status;
            context.Response.ContentType = "application/json";
            context.Response.ContentLength64 = bytes.Length;
            await context.Response.OutputStream.WriteAsync(bytes).ConfigureAwait(false);
            context.Response.Close();
        }
    }

    /// <summary>
    /// HttpListener needs a concrete port in its prefix, so one is reserved and
    /// released first rather than binding to port 0.
    /// </summary>
    private static int FindFreePort()
    {
        var probe = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }

    public void Dispose()
    {
        _stopping.Cancel();
        _listener.Close();
        _stopping.Dispose();
    }
}

internal sealed record RecordedRequest(IReadOnlyDictionary<string, string> Headers, string Body)
{
    internal string? Header(string name) => Headers.TryGetValue(name, out var value) ? value : null;

    internal JsonElement Payload() => JsonDocument.Parse(Body).RootElement;
}
