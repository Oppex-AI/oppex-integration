package dev.oppex.sdk.internal.async;

import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

final class DaemonThreadFactory implements ThreadFactory {
    private final AtomicInteger sequence = new AtomicInteger();

    public Thread newThread(Runnable runnable) {
        Thread thread = new Thread(runnable, "oppex-incident-worker-" + sequence.incrementAndGet());
        thread.setDaemon(true);
        return thread;
    }
}

