package dev.oppex.sdk.internal.retry;

import dev.oppex.sdk.exception.IncidentException;
import dev.oppex.sdk.internal.metrics.InternalMetrics;

import java.io.IOException;

/** Internal retry policy. This type is not part of the supported SDK API. */
public final class RetryExecutor {
    public interface Operation<T> {
        T execute() throws IOException, IncidentException;
    }

    interface Sleeper {
        void sleep(long millis) throws InterruptedException;
    }

    private final long[] delaysMillis;
    private final Sleeper sleeper;
    private final InternalMetrics metrics;

    public RetryExecutor(InternalMetrics metrics) {
        this(new long[] {500L, 1000L, 2000L, 4000L, 8000L}, new Sleeper() {
            public void sleep(long millis) throws InterruptedException {
                Thread.sleep(millis);
            }
        }, metrics);
    }

    RetryExecutor(long[] delaysMillis, Sleeper sleeper, InternalMetrics metrics) {
        this.delaysMillis = copy(delaysMillis);
        this.sleeper = sleeper;
        this.metrics = metrics;
    }

    public <T> T execute(Operation<T> operation) throws IncidentException {
        if (operation == null) {
            throw new IllegalArgumentException("operation must not be null");
        }

        int retry = 0;
        while (true) {
            try {
                return operation.execute();
            } catch (IncidentException failure) {
                if (!failure.isRetryable() || retry >= delaysMillis.length) {
                    throw failure;
                }
                waitBeforeRetry(delaysMillis[retry++]);
            } catch (IOException failure) {
                if (Thread.currentThread().isInterrupted() || retry >= delaysMillis.length) {
                    throw new IncidentException("Incident delivery failed after " + (retry + 1) + " attempts",
                            failure, -1, false);
                }
                waitBeforeRetry(delaysMillis[retry++]);
            }
        }
    }

    private void waitBeforeRetry(long delayMillis) throws IncidentException {
        metrics.incrementRetried();
        try {
            sleeper.sleep(delayMillis);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IncidentException("Incident delivery interrupted during retry", interrupted, -1, false);
        }
    }

    private static long[] copy(long[] values) {
        long[] result = new long[values.length];
        System.arraycopy(values, 0, result, 0, values.length);
        return result;
    }
}
