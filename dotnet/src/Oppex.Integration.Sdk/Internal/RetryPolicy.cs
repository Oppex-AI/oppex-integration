namespace Oppex.Integration.Sdk.Internal;

/// <summary>The retry policy. Not public API.</summary>
internal static class RetryPolicy
{
    /// <summary>
    /// Five retries after the first attempt, doubling, without jitter.
    /// Deliberately not configurable.
    /// </summary>
    internal static readonly TimeSpan[] DefaultDelays =
    [
        TimeSpan.FromMilliseconds(500),
        TimeSpan.FromMilliseconds(1000),
        TimeSpan.FromMilliseconds(2000),
        TimeSpan.FromMilliseconds(4000),
        TimeSpan.FromMilliseconds(8000),
    ];

    /// <summary>
    /// An explicit list rather than "any 5xx". Widening it is a deliberate policy
    /// change, not an incidental one.
    /// </summary>
    internal static bool IsRetryableStatus(int statusCode) =>
        statusCode is 429 or 500 or 502 or 503 or 504;

    /// <summary>
    /// Runs <paramref name="operation"/> until it succeeds, fails with a
    /// non-retryable error, or exhausts <paramref name="delays"/>.
    /// </summary>
    /// <remarks>
    /// Only the final failure is thrown. Individual attempts are never logged, so
    /// a saturated Oppex API cannot flood the host's logs.
    /// </remarks>
    internal static async Task<T> ExecuteAsync<T>(
        IReadOnlyList<TimeSpan> delays,
        Func<CancellationToken, Task<T>> operation,
        TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await operation(cancellationToken).ConfigureAwait(false);
            }
            catch (IncidentException failure) when (failure.Retryable && attempt < delays.Count)
            {
                // Delay honours the caller's token, so a cancelled post abandons
                // its backoff immediately instead of waiting out eight seconds.
                await Task.Delay(delays[attempt], timeProvider, cancellationToken).ConfigureAwait(false);
            }
            catch (IncidentException failure) when (failure.Retryable)
            {
                throw WithAttemptCount(failure, attempt + 1);
            }
        }
    }

    /// <summary>
    /// Annotates only a failure that never reached a status line. An HTTP failure
    /// keeps the message its status already explains.
    /// </summary>
    private static IncidentException WithAttemptCount(IncidentException failure, int attempts) =>
        failure.HasHttpStatus || attempts < 2
            ? failure
            : new IncidentException(
                $"{failure.Message} (after {attempts} attempts)",
                failure.StatusCode,
                failure.Retryable,
                failure.InnerException);
}
