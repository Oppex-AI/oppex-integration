using Microsoft.Extensions.Logging;
using Oppex.Integration.Sdk.Internal;

namespace Oppex.Integration.Sdk;

/// <summary>Posts incidents to Oppex.</summary>
/// <remarks>
/// <para>
/// The client is thread safe and intended to be shared. Create one per
/// application, reuse it, and dispose it during shutdown.
/// </para>
/// <code>
/// await using var client = new IncidentClient(new IncidentClientOptions
/// {
///     ApiKey = apiKey,
///     ServiceKey = serviceKey,
/// });
///
/// var response = await client.PostAsync(new IncidentRequest
/// {
///     Title = "Checkout latency breached the SLO",
///     Source = "checkout-api",
///     Severity = Severity.High,
/// });
/// </code>
/// </remarks>
public sealed class IncidentClient : IAsyncDisposable, IDisposable
{
    /// <summary>The Oppex incident endpoint every client posts to.</summary>
    public const string DefaultEndpoint = "https://api.oppex.ai/api/v1/incident/post";

    /// <summary>
    /// Redirects the whole delivery path at a loopback server. This exists so
    /// tests and the external smoke consumer can exercise the real transport; it
    /// is deliberately not an option on <see cref="IncidentClientOptions"/>,
    /// which would add a public knob that exists only to ease testing.
    /// </summary>
    private const string EndpointOverrideVariable = "OPPEX_TEST_ENDPOINT_URL";

    private readonly string? _serviceKey;
    private readonly ILogger _logger;
    private readonly HttpTransport _transport;
    private readonly AsyncDispatcher _dispatcher;
    private readonly TimeProvider _timeProvider;
    private readonly IReadOnlyList<TimeSpan> _retryDelays;
    private volatile bool _disposed;

    /// <summary>Creates a client.</summary>
    /// <exception cref="ArgumentException">The API key is missing or blank.</exception>
    public IncidentClient(IncidentClientOptions options)
        : this(options, TimeProvider.System, RetryPolicy.DefaultDelays)
    {
    }

    /// <summary>
    /// Test constructor. The retry schedule and clock are injectable only from
    /// inside this assembly, so the public surface never grows a retry knob.
    /// </summary>
    internal IncidentClient(IncidentClientOptions options, TimeProvider timeProvider,
        IReadOnlyList<TimeSpan> retryDelays)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (string.IsNullOrWhiteSpace(options.ApiKey))
        {
            throw new ArgumentException("ApiKey must not be blank", nameof(options));
        }

        _serviceKey = string.IsNullOrWhiteSpace(options.ServiceKey) ? null : options.ServiceKey;
        _logger = options.Logger;
        _timeProvider = timeProvider;
        _retryDelays = retryDelays;
        _transport = new HttpTransport(options.ApiKey, ResolveEndpoint());
        _dispatcher = new AsyncDispatcher(_logger, timeProvider);
    }

    /// <summary>
    /// Delivers an incident and waits for the result, including any retry delays.
    /// The request's own service key overrides the client's.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// The request is invalid, or neither the client nor the request carries a
    /// service key.
    /// </exception>
    /// <exception cref="ObjectDisposedException">The client was disposed.</exception>
    /// <exception cref="IncidentException">Delivery failed.</exception>
    public Task<IncidentResponse> PostAsync(IncidentRequest request, CancellationToken cancellationToken = default)
    {
        var normalized = Prepare(request);
        if (normalized.ServiceKey is null && _serviceKey is null)
        {
            throw new ArgumentException(
                "No ServiceKey is configured on the client or the request; supply one or use " +
                nameof(PostWithServiceRoutingAsync),
                nameof(request));
        }

        return DeliverAsync(normalized, _serviceKey, cancellationToken);
    }

    /// <summary>
    /// Delivers an incident without a service key so Oppex resolves the target
    /// service itself. The request must not carry its own service key. Otherwise
    /// identical to <see cref="PostAsync"/>.
    /// </summary>
    public Task<IncidentResponse> PostWithServiceRoutingAsync(
        IncidentRequest request, CancellationToken cancellationToken = default) =>
        DeliverAsync(PrepareForServiceRouting(request), null, cancellationToken);

    /// <summary>
    /// Queues a best-effort delivery and returns immediately.
    /// </summary>
    /// <remarks>
    /// Named <c>Enqueue</c> rather than following the Java SDK's <c>postAsync</c>:
    /// in .NET an <c>Async</c> suffix promises an awaitable, and this method
    /// deliberately is not one. Validation and the disposed check still run on the
    /// calling thread, so a misuse is thrown to the caller rather than lost in a
    /// worker. A delivery failure after queueing is logged at debug level.
    /// </remarks>
    public void Enqueue(IncidentRequest request)
    {
        var normalized = Prepare(request);
        if (normalized.ServiceKey is null && _serviceKey is null)
        {
            throw new ArgumentException(
                "No ServiceKey is configured on the client or the request; supply one or use " +
                nameof(EnqueueWithServiceRouting),
                nameof(request));
        }

        Submit(normalized, _serviceKey);
    }

    /// <summary>
    /// Queues a best-effort service-routed delivery. The request must not carry
    /// its own service key.
    /// </summary>
    public void EnqueueWithServiceRouting(IncidentRequest request) =>
        Submit(PrepareForServiceRouting(request), null);

    /// <summary>
    /// Drains queued work for up to ten seconds, then releases every owned
    /// resource. Idempotent.
    /// </summary>
    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        await _dispatcher.DisposeAsync().ConfigureAwait(false);
        _transport.Dispose();
    }

    /// <summary>
    /// Synchronous disposal, for callers that cannot await. Prefer
    /// <see cref="DisposeAsync"/>: this blocks the calling thread for the drain.
    /// </summary>
    public void Dispose() => DisposeAsync().AsTask().GetAwaiter().GetResult();

    private static Uri ResolveEndpoint()
    {
        var overrideUrl = Environment.GetEnvironmentVariable(EndpointOverrideVariable);
        return new Uri(string.IsNullOrEmpty(overrideUrl) ? DefaultEndpoint : overrideUrl);
    }

    private NormalizedRequest Prepare(IncidentRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ObjectDisposedException.ThrowIf(_disposed, this);
        return request.Normalize();
    }

    private NormalizedRequest PrepareForServiceRouting(IncidentRequest request)
    {
        var normalized = Prepare(request);
        return normalized.ServiceKey is null
            ? normalized
            : throw new ArgumentException(
                "Request must not carry a ServiceKey when service routing is used", nameof(request));
    }

    private void Submit(NormalizedRequest request, string? defaultServiceKey)
    {
        var accepted = _dispatcher.Submit(async cancellationToken =>
        {
            try
            {
                // No disposed check here: CloseAsync drains the dispatcher before
                // the transport is released, so a task queued before disposal
                // still has a live connection pool, and a task submitted after
                // disposal was already refused below.
                await DeliverAsync(request, defaultServiceKey, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception failure) when (failure is IncidentException or OperationCanceledException)
            {
                Log.QueuedDeliveryFailed(_logger, failure);
            }
        });

        ObjectDisposedException.ThrowIf(!accepted, this);
    }

    /// <summary>
    /// Serializes, sends and retries a single incident. The request's own service
    /// key wins over <paramref name="defaultServiceKey"/>.
    /// </summary>
    private Task<IncidentResponse> DeliverAsync(
        NormalizedRequest request, string? defaultServiceKey, CancellationToken cancellationToken)
    {
        var payload = WireCodec.SerializeRequest(request, request.ServiceKey ?? defaultServiceKey);
        return RetryPolicy.ExecuteAsync(
            _retryDelays, token => _transport.SendAsync(payload, token), _timeProvider, cancellationToken);
    }
}
