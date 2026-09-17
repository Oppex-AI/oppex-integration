using System.Threading.Channels;
using Microsoft.Extensions.Logging;

namespace Oppex.Integration.Sdk.Internal;

/// <summary>
/// Delivers queued incidents on a fixed number of worker tasks, holding the rest
/// in a bounded channel that drops the oldest entry once full. Not public API.
/// </summary>
/// <remarks>
/// Dropping the oldest keeps the newest incident, which is the one most likely to
/// still matter, and enqueueing never blocks the application.
/// <see cref="BoundedChannelFullMode.DropOldest"/> is exactly that policy, so no
/// hand-written queue is needed here the way the sibling SDKs need one.
/// </remarks>
internal sealed class AsyncDispatcher : IAsyncDisposable
{
    internal const int QueueCapacity = 5000;
    internal const int WorkerCount = 2;
    internal static readonly TimeSpan CloseDrainTimeout = TimeSpan.FromSeconds(10);

    private readonly Channel<Func<CancellationToken, Task>> _queue;
    private readonly CancellationTokenSource _abandon = new();
    private readonly Task[] _workers;
    private readonly RateLimitedDropLogger _dropLogger;
    private readonly ILogger _logger;
    private readonly Lock _lifecycle = new();
    private bool _closed;

    internal AsyncDispatcher(ILogger logger, TimeProvider timeProvider, int workerCount = WorkerCount,
        int capacity = QueueCapacity)
    {
        _logger = logger;
        _dropLogger = new RateLimitedDropLogger(timeProvider);
        _queue = Channel.CreateBounded<Func<CancellationToken, Task>>(
            new BoundedChannelOptions(capacity)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = false,
                SingleWriter = false,
            },
            _ => ReportDrop());

        _workers = new Task[workerCount];
        for (var index = 0; index < workerCount; index++)
        {
            _workers[index] = Task.Run(WorkAsync);
        }
    }

    /// <summary>
    /// Queues a task. Returns whether it was accepted; only a closed dispatcher
    /// refuses.
    /// </summary>
    internal bool Submit(Func<CancellationToken, Task> task)
    {
        lock (_lifecycle)
        {
            // Checked under the lock: Close completes the writer, and writing to
            // a completed channel is a race this check closes rather than an
            // exception to catch.
            return !_closed && _queue.Writer.TryWrite(task);
        }
    }

    /// <summary>
    /// Stops admitting work and drains what is already queued and in flight for up
    /// to <see cref="CloseDrainTimeout"/>, then abandons the rest by cancelling
    /// the shared task token. Idempotent.
    /// </summary>
    internal async Task CloseAsync(TimeSpan timeout)
    {
        lock (_lifecycle)
        {
            if (_closed)
            {
                return;
            }

            _closed = true;
            _queue.Writer.TryComplete();
        }

        var drained = Task.WhenAll(_workers);
        if (await Task.WhenAny(drained, Task.Delay(timeout)).ConfigureAwait(false) == drained)
        {
            return;
        }

        var abandoned = _queue.Reader.Count;
        // Cancelling aborts the in-flight HTTP request rather than waiting for
        // it, which is what keeps this method inside its own timeout.
        await _abandon.CancelAsync().ConfigureAwait(false);

        // Reported once and directly, rather than through the rate-limited
        // overflow counter: a shutdown loss and an overload loss are different
        // events, and a rate-limited counter's last batch can go unreported.
        if (abandoned > 0)
        {
            Log.IncidentsForceDropped(_logger, abandoned);
        }
    }

    private async Task WorkAsync()
    {
        try
        {
            await foreach (var task in _queue.Reader.ReadAllAsync(_abandon.Token).ConfigureAwait(false))
            {
                await task(_abandon.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Close gave up waiting. Abandoning the rest is the documented
            // behaviour, not a failure.
        }
    }

    private void ReportDrop()
    {
        var dropped = _dropLogger.RecordDrop();
        if (dropped is > 0)
        {
            Log.IncidentsDropped(_logger, dropped.Value);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await CloseAsync(CloseDrainTimeout).ConfigureAwait(false);
        _abandon.Dispose();
    }
}
