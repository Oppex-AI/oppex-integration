package dev.oppex.sdk.internal.async;

import java.util.concurrent.RejectedExecutionHandler;
import java.util.concurrent.ThreadPoolExecutor;

final class DropOldestRejectedExecutionHandler implements RejectedExecutionHandler {
    public void rejectedExecution(Runnable task, ThreadPoolExecutor executor) {
        if (executor.isShutdown()) {
            drop(task);
            return;
        }

        Runnable oldest = executor.getQueue().poll();
        if (oldest != null) {
            drop(oldest);
        }

        if (executor.isShutdown() || !executor.getQueue().offer(task)) {
            drop(task);
        }
    }

    private static void drop(Runnable task) {
        if (task instanceof TrackedTask) {
            ((TrackedTask) task).drop();
        }
    }
}

