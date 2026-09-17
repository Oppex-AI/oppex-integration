using System.Net;
using System.Net.Http.Headers;
using System.Text;

namespace Oppex.Integration.Sdk.Internal;

/// <summary>
/// The HTTP adapter. It owns the connection pool, so disposing a client releases
/// the sockets that client opened and no others. Not public API.
/// </summary>
internal sealed class HttpTransport : IDisposable
{
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan ResponseTimeout = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Bounds a whole attempt so a server that trickles bytes forever cannot hold
    /// a delivery open past the sum of its phase timeouts.
    /// </summary>
    private static readonly TimeSpan AttemptTimeout = ConnectTimeout + ResponseTimeout;

    private const int MaxConnections = 20;

    /// <summary>
    /// The API returns a small envelope. Anything larger is a misbehaving proxy,
    /// and reading it in full would let that proxy dictate this client's memory use.
    /// </summary>
    private const long MaxResponseBytes = 1024 * 1024;

    private static readonly MediaTypeHeaderValue JsonContentType = new("application/json") { CharSet = "utf-8" };

    private readonly HttpClient _httpClient;
    private readonly Uri _endpoint;
    private readonly string _apiKey;

    internal HttpTransport(string apiKey, Uri endpoint)
    {
        _apiKey = apiKey;
        _endpoint = endpoint;
        _httpClient = new HttpClient(
            new SocketsHttpHandler
            {
                ConnectTimeout = ConnectTimeout,
                ResponseDrainTimeout = ResponseTimeout,
                MaxConnectionsPerServer = MaxConnections,
                // Bounded so a long-lived process still picks up DNS changes,
                // which a pooled connection would otherwise hide indefinitely.
                PooledConnectionLifetime = TimeSpan.FromMinutes(2),
                AutomaticDecompression = DecompressionMethods.All,
            },
            disposeHandler: true)
        {
            Timeout = AttemptTimeout,
            MaxResponseContentBufferSize = MaxResponseBytes,
        };
        _httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    /// <summary>
    /// Performs one attempt. Every failure it throws is an
    /// <see cref="IncidentException"/> whose <see cref="IncidentException.Retryable"/>
    /// already carries the retry decision, so the retry policy never has to know
    /// which library threw what.
    /// </summary>
    internal async Task<IncidentResponse> SendAsync(byte[] payload, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, _endpoint);
        request.Headers.TryAddWithoutValidation("X-API-KEY", _apiKey);
        request.Content = new ByteArrayContent(payload);
        request.Content.Headers.ContentType = JsonContentType;

        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The caller cancelled. That is their decision, not a delivery
            // failure to retry, so it propagates unchanged.
            throw;
        }
        catch (Exception failure) when (failure is HttpRequestException or OperationCanceledException or IOException)
        {
            // No status line was received, so the failure is transport-level and
            // retryable regardless of which layer threw it. A bare
            // OperationCanceledException here is HttpClient.Timeout expiring.
            throw new IncidentException(
                "incident delivery failed before a response was received",
                IncidentException.NoStatusCode,
                retryable: true,
                failure);
        }

        using (response)
        {
            var statusCode = (int)response.StatusCode;
            var body = await ReadBodyAsync(response, cancellationToken).ConfigureAwait(false);
            return response.IsSuccessStatusCode
                ? WireCodec.ParseResponse(statusCode, body)
                : throw StatusFailure(statusCode, body);
        }
    }

    private static async Task<string> ReadBodyAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            using var reader = new StreamReader(stream, Encoding.UTF8);
            var buffer = new char[MaxResponseBytes];
            var read = await reader.ReadBlockAsync(buffer, cancellationToken).ConfigureAwait(false);
            return new string(buffer, 0, read);
        }
        catch (Exception failure) when (failure is HttpRequestException or IOException)
        {
            throw new IncidentException(
                "reading the Oppex response body", IncidentException.NoStatusCode, retryable: true, failure);
        }
    }

    /// <summary>
    /// Turns a non-2xx response into a delivery failure, adding the API's own
    /// message when the body carries one.
    /// </summary>
    private static IncidentException StatusFailure(int statusCode, string body)
    {
        var message = $"Oppex returned HTTP {statusCode}";
        try
        {
            var parsed = WireCodec.ParseResponse(statusCode, body);
            if (!string.IsNullOrWhiteSpace(parsed.Message))
            {
                message = $"{message}: {parsed.Message}";
            }
        }
        catch (IncidentException)
        {
            // The status code remains sufficient when the body is not JSON.
        }

        return new IncidentException(message, statusCode, RetryPolicy.IsRetryableStatus(statusCode));
    }

    public void Dispose() => _httpClient.Dispose();
}
