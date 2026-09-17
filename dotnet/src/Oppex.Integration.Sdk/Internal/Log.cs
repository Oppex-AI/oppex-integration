using Microsoft.Extensions.Logging;

namespace Oppex.Integration.Sdk.Internal;

/// <summary>
/// Every log message this SDK emits, as source-generated delegates.
/// </summary>
/// <remarks>
/// Written with <see cref="LoggerMessageAttribute"/> rather than the
/// <c>LogWarning</c> extension methods: the generated code allocates nothing per
/// call and uses no reflection, which is what keeps the assembly trimmable and
/// AOT-safe. Keeping them in one file also makes the SDK's whole logging surface
/// reviewable at a glance, including that none of it can carry an API key or a
/// response body.
/// </remarks>
internal static partial class Log
{
    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Oppex dropped {Dropped} incidents in the last minute.")]
    internal static partial void IncidentsDropped(ILogger logger, int dropped);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "Oppex force-dropped {Dropped} pending incidents during close.")]
    internal static partial void IncidentsForceDropped(ILogger logger, int dropped);

    [LoggerMessage(
        EventId = 3,
        Level = LogLevel.Debug,
        Message = "Oppex queued incident delivery failed.")]
    internal static partial void QueuedDeliveryFailed(ILogger logger, Exception failure);
}
