using Microsoft.Extensions.Time.Testing;
using Oppex.Integration.Sdk.Internal;

namespace Oppex.Integration.Sdk.Tests;

public class RetryPolicyTests
{
    private static readonly TimeSpan[] FastDelays =
        [.. Enumerable.Repeat(TimeSpan.FromMilliseconds(1), 5)];

    [Theory]
    [InlineData(429)]
    [InlineData(500)]
    [InlineData(502)]
    [InlineData(503)]
    [InlineData(504)]
    public void TheRetryableStatusListIsExplicit(int status) =>
        Assert.True(RetryPolicy.IsRetryableStatus(status));

    [Theory]
    [InlineData(400)]
    [InlineData(401)]
    [InlineData(403)]
    [InlineData(404)]
    [InlineData(409)]
    [InlineData(422)]
    [InlineData(501)]
    [InlineData(505)]
    public void EveryOtherStatusIsNonRetryable(int status) =>
        Assert.False(RetryPolicy.IsRetryableStatus(status));

    [Fact]
    public void TheScheduleDoublesFromHalfASecond() =>
        Assert.Equal(
            [
                TimeSpan.FromMilliseconds(500),
                TimeSpan.FromSeconds(1),
                TimeSpan.FromSeconds(2),
                TimeSpan.FromSeconds(4),
                TimeSpan.FromSeconds(8),
            ],
            RetryPolicy.DefaultDelays);

    [Fact]
    public async Task TheFirstSuccessStopsTheLoop()
    {
        var attempts = 0;

        var result = await RetryPolicy.ExecuteAsync(
            FastDelays,
            _ =>
            {
                attempts++;
                return attempts < 3
                    ? throw new IncidentException("503", 503, retryable: true)
                    : Task.FromResult("delivered");
            },
            TimeProvider.System,
            TestContext.Current.CancellationToken);

        Assert.Equal("delivered", result);
        Assert.Equal(3, attempts);
    }

    [Fact]
    public async Task ANonRetryableFailureIsNotRetried()
    {
        var attempts = 0;

        await Assert.ThrowsAsync<IncidentException>(() => RetryPolicy.ExecuteAsync<string>(
            FastDelays,
            _ =>
            {
                attempts++;
                throw new IncidentException("401", 401, retryable: false);
            },
            TimeProvider.System,
            TestContext.Current.CancellationToken));

        Assert.Equal(1, attempts);
    }

    [Fact]
    public async Task AnExhaustedHttpFailureKeepsItsOriginalMessage()
    {
        var attempts = 0;

        var failure = await Assert.ThrowsAsync<IncidentException>(() => RetryPolicy.ExecuteAsync<string>(
            FastDelays,
            _ =>
            {
                attempts++;
                throw new IncidentException("Oppex returned HTTP 503", 503, retryable: true);
            },
            TimeProvider.System,
            TestContext.Current.CancellationToken));

        Assert.Equal(FastDelays.Length + 1, attempts);
        Assert.Equal("Oppex returned HTTP 503", failure.Message);
    }

    [Fact]
    public async Task OnlyAFailureThatNeverReachedAStatusLineIsAnnotated()
    {
        var failure = await Assert.ThrowsAsync<IncidentException>(() => RetryPolicy.ExecuteAsync<string>(
            FastDelays,
            _ => throw new IncidentException(
                "connection refused", IncidentException.NoStatusCode, retryable: true),
            TimeProvider.System,
            TestContext.Current.CancellationToken));

        Assert.Equal("connection refused (after 6 attempts)", failure.Message);
    }

    [Fact]
    public async Task CancellationAbandonsTheBackoffImmediately()
    {
        // A fake clock proves the wait is abandoned rather than waited out: real
        // time never advances during this test.
        var timeProvider = new FakeTimeProvider();
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => RetryPolicy.ExecuteAsync<string>(
            RetryPolicy.DefaultDelays,
            _ => throw new IncidentException("503", 503, retryable: true),
            timeProvider,
            cancellation.Token));
    }
}
