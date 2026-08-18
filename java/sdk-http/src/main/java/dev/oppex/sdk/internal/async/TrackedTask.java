package dev.oppex.sdk.internal.async;

import dev.oppex.sdk.internal.metrics.InternalMetrics;

import java.util.concurrent.atomic.AtomicBoolean;

final class TrackedTask implements Runnable {
    private final Runnable delegate;
    private final InternalMetrics metrics;
    private final RateLimitedDropLogger dropLogger;
    private final AtomicBoolean startedOrDropped = new AtomicBoolean();

    TrackedTask(Runnable delegate, InternalMetrics metrics, RateLimitedDropLogger dropLogger) {
        this.delegate = delegate;
        this.metrics = metrics;
        this.dropLogger = dropLogger;
    }

    public void run() {
        if (!startedOrDropped.compareAndSet(false, true)) {
            return;
        }
        metrics.decrementQueued();
        delegate.run();
    }

    void drop() {
        if (!startedOrDropped.compareAndSet(false, true)) {
            return;
        }
        metrics.decrementQueued();
        metrics.incrementDropped();
        dropLogger.recordDrop();
    }
}

