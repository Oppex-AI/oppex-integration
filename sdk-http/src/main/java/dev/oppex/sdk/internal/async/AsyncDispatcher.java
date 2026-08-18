package dev.oppex.sdk.internal.async;

import dev.oppex.sdk.internal.metrics.InternalMetrics;

import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Logger;

/** Internal bounded asynchronous dispatcher. This type is not part of the supported SDK API. */
public final class AsyncDispatcher {
    private static final int WORKER_COUNT = 2;
    private static final int QUEUE_CAPACITY = 5000;
    private static final long SHUTDOWN_TIMEOUT_SECONDS = 10L;

    private final InternalMetrics metrics;
    private final RateLimitedDropLogger dropLogger;
    private final ThreadPoolExecutor executor;
    private final AtomicBoolean closed = new AtomicBoolean();

    public AsyncDispatcher(InternalMetrics metrics) {
        this(metrics, WORKER_COUNT, QUEUE_CAPACITY,
                new RateLimitedDropLogger(Logger.getLogger(AsyncDispatcher.class.getName())));
    }

    AsyncDispatcher(InternalMetrics metrics, int workerCount, int queueCapacity,
            RateLimitedDropLogger dropLogger) {
        this.metrics = metrics;
        this.dropLogger = dropLogger;
        this.executor = new ThreadPoolExecutor(workerCount, workerCount, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<Runnable>(queueCapacity), new DaemonThreadFactory(),
                new DropOldestRejectedExecutionHandler());
    }

    public void submit(Runnable task) {
        if (task == null) {
            throw new IllegalArgumentException("task must not be null");
        }
        if (closed.get()) {
            throw new IllegalStateException("IncidentClient is closed");
        }

        TrackedTask trackedTask = new TrackedTask(task, metrics, dropLogger);
        metrics.incrementQueued();
        executor.execute(trackedTask);
    }

    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }

        executor.shutdown();
        boolean terminated = false;
        try {
            terminated = executor.awaitTermination(SHUTDOWN_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
        if (!terminated) {
            dropPending(executor.shutdownNow());
        }
    }

    private static void dropPending(List<Runnable> pending) {
        for (int i = 0; i < pending.size(); i++) {
            Runnable task = pending.get(i);
            if (task instanceof TrackedTask) {
                ((TrackedTask) task).drop();
            }
        }
    }
}

