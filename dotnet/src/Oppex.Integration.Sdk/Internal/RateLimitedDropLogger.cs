namespace Oppex.Integration.Sdk.Internal;

/// <summary>
/// Counts every dropped incident but reports at most one summary per interval.
/// Not public API.
/// </summary>
/// <remarks>
/// A saturated queue drops continuously, so logging each drop would replace one
/// overload with another. Returning the count instead of logging keeps this class
/// free of any logging decision, which is also what makes it testable without
/// capturing output.
/// </remarks>
internal sealed class RateLimitedDropLogger(TimeProvider timeProvider, TimeSpan? interval = null)
{
    private static readonly TimeSpan DefaultInterval = TimeSpan.FromMinutes(1);

    private readonly TimeSpan _interval = interval ?? DefaultInterval;
    private readonly Lock _gate = new();
    private long _startedAtTicks = timeProvider.GetTimestamp();
    private int _dropped;

    /// <summary>
    /// Records one drop, returning the accumulated count when the interval has
    /// elapsed and the caller should report a summary, or null otherwise.
    /// </summary>
    internal int? RecordDrop()
    {
        lock (_gate)
        {
            _dropped++;
            var now = timeProvider.GetTimestamp();
            if (timeProvider.GetElapsedTime(_startedAtTicks, now) < _interval)
            {
                return null;
            }

            var dropped = _dropped;
            _dropped = 0;
            _startedAtTicks = now;
            return dropped;
        }
    }
}
