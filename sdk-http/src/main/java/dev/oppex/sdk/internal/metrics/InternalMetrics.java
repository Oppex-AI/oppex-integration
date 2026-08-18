package dev.oppex.sdk.internal.metrics;

import java.util.concurrent.atomic.AtomicLong;

/** Internal counters. This type is not part of the supported SDK API. */
public final class InternalMetrics {
    private final AtomicLong queued = new AtomicLong();
    private final AtomicLong processed = new AtomicLong();
    private final AtomicLong successful = new AtomicLong();
    private final AtomicLong failed = new AtomicLong();
    private final AtomicLong retried = new AtomicLong();
    private final AtomicLong dropped = new AtomicLong();

    public void incrementQueued() {
        queued.incrementAndGet();
    }

    public void decrementQueued() {
        queued.decrementAndGet();
    }

    public void incrementProcessed() {
        processed.incrementAndGet();
    }

    public void incrementSuccessful() {
        successful.incrementAndGet();
    }

    public void incrementFailed() {
        failed.incrementAndGet();
    }

    public void incrementRetried() {
        retried.incrementAndGet();
    }

    public void incrementDropped() {
        dropped.incrementAndGet();
    }

    public long getQueued() {
        return queued.get();
    }

    public long getProcessed() {
        return processed.get();
    }

    public long getSuccessful() {
        return successful.get();
    }

    public long getFailed() {
        return failed.get();
    }

    public long getRetried() {
        return retried.get();
    }

    public long getDropped() {
        return dropped.get();
    }
}

