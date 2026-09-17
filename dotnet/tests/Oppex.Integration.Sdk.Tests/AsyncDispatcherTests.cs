using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Oppex.Integration.Sdk.Internal;

namespace Oppex.Integration.Sdk.Tests;

public class AsyncDispatcherTests
{
    private static AsyncDispatcher Dispatcher(int workerCount = 2, int capacity = 10) =>
        new(NullLogger.Instance, TimeProvider.System, workerCount, capacity);

    [Fact]
    public async Task SubmittedWorkRuns()
    {
        await using var dispatcher = Dispatcher();
        using var delivered = new CountdownEvent(5);

        for (var index = 0; index < 5; index++)
        {
            Assert.True(dispatcher.Submit(_ =>
            {
                delivered.Signal();
                return Task.CompletedTask;
            }));
        }

        Assert.True(delivered.Wait(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task TheOldestQueuedTaskIsDroppedWhenFull()
    {
        // One worker, held on a gate, so everything else has to queue.
        await using var dispatcher = Dispatcher(workerCount: 1, capacity: 2);
        using var gate = new SemaphoreSlim(0);
        using var started = new SemaphoreSlim(0);

        dispatcher.Submit(async _ =>
        {
            started.Release();
            await gate.WaitAsync(TestContext.Current.CancellationToken);
        });
        await started.WaitAsync(TestContext.Current.CancellationToken);

        var ran = new System.Collections.Concurrent.ConcurrentQueue<string>();
        foreach (var name in new[] { "oldest", "middle", "newest" })
        {
            dispatcher.Submit(_ =>
            {
                ran.Enqueue(name);
                return Task.CompletedTask;
            });
        }

        gate.Release();
        await dispatcher.CloseAsync(TimeSpan.FromSeconds(5));

        Assert.Equal(2, ran.Count);
        Assert.DoesNotContain("oldest", ran);
    }

    [Fact]
    public async Task AClosedDispatcherRefusesWorkAndCloseIsIdempotent()
    {
        var dispatcher = Dispatcher(workerCount: 1, capacity: 4);
        await dispatcher.CloseAsync(TimeSpan.FromSeconds(1));
        await dispatcher.CloseAsync(TimeSpan.FromSeconds(1));

        Assert.False(dispatcher.Submit(_ => Task.CompletedTask));
        await dispatcher.DisposeAsync();
    }

    [Fact]
    public async Task CloseGivesUpOnWorkThatOutlastsTheDrainTimeout()
    {
        var dispatcher = Dispatcher(workerCount: 1, capacity: 10);
        using var gate = new SemaphoreSlim(0);
        using var started = new SemaphoreSlim(0);

        dispatcher.Submit(async token =>
        {
            started.Release();
            await gate.WaitAsync(token);
        });
        await started.WaitAsync(TestContext.Current.CancellationToken);

        var ran = 0;
        dispatcher.Submit(_ =>
        {
            Interlocked.Increment(ref ran);
            return Task.CompletedTask;
        });

        var began = DateTime.UtcNow;
        await dispatcher.CloseAsync(TimeSpan.FromMilliseconds(100));
        var elapsed = DateTime.UtcNow - began;

        Assert.True(elapsed < TimeSpan.FromSeconds(5), $"close waited {elapsed}, well past its timeout");
        Assert.Equal(0, Volatile.Read(ref ran));
        await dispatcher.DisposeAsync();
    }

    [Fact]
    public void TheDropLoggerReportsAtMostOncePerInterval()
    {
        var timeProvider = new FakeTimeProvider();
        var logger = new RateLimitedDropLogger(timeProvider, TimeSpan.FromMinutes(1));

        for (var drop = 0; drop < 10; drop++)
        {
            Assert.Null(logger.RecordDrop());
        }

        timeProvider.Advance(TimeSpan.FromMinutes(2));

        Assert.Equal(11, logger.RecordDrop());
        // The counter resets, so the next interval starts from zero rather than
        // re-reporting everything seen so far.
        timeProvider.Advance(TimeSpan.FromMinutes(2));
        Assert.Equal(1, logger.RecordDrop());
    }
}
