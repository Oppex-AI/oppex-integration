using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Oppex.Integration.Sdk;

/// <summary>Configuration for an <see cref="IncidentClient"/>.</summary>
/// <remarks>
/// This is the whole configuration surface, deliberately. Timeouts, the retry
/// schedule, the retryable status list, the queue bound and the drain timeout are
/// part of the cross-language incident contract, not per-caller settings.
/// </remarks>
public sealed class IncidentClientOptions
{
    /// <summary>
    /// The API key sent in the <c>X-API-KEY</c> header. Required, non-blank.
    /// </summary>
    public required string ApiKey { get; init; }

    /// <summary>
    /// The default service for incidents that do not carry their own. When
    /// omitted, incidents must either supply one or be posted with
    /// <see cref="IncidentClient.PostWithServiceRoutingAsync"/>.
    /// </summary>
    public string? ServiceKey { get; init; }

    /// <summary>
    /// Receives this client's internal logging. Defaults to a no-op logger, so
    /// the SDK never writes anywhere the host did not ask for.
    /// </summary>
    public ILogger Logger { get; init; } = NullLogger.Instance;
}
