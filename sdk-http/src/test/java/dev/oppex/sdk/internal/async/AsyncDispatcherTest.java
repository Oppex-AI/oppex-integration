package dev.oppex.sdk.internal.async;

import dev.oppex.sdk.internal.metrics.InternalMetrics;
import org.junit.Test;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class AsyncDispatcherTest {
    @Test
    public void queueOverflowDropsOldestAndKeepsNewest() throws Exception {
        final InternalMetrics metrics = new InternalMetrics();
        final CountDownLatch workerStarted = new CountDownLatch(1);
        final CountDownLatch releaseWorker = new CountDownLatch(1);
        final List<String> executed = new CopyOnWriteArrayList<String>();
        AsyncDispatcher dispatcher = new AsyncDispatcher(metrics, 1, 2,
                new RateLimitedDropLogger(Logger.getLogger("async-test")));

        dispatcher.submit(new Runnable() {
            public void run() {
                workerStarted.countDown();
                try {
                    releaseWorker.await();
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
                executed.add("blocking");
            }
        });
        assertTrue(workerStarted.await(2L, TimeUnit.SECONDS));

        dispatcher.submit(record(executed, "oldest"));
        dispatcher.submit(record(executed, "middle"));
        dispatcher.submit(record(executed, "newest"));
        releaseWorker.countDown();
        dispatcher.close();

        assertTrue(executed.contains("blocking"));
        assertFalse(executed.contains("oldest"));
        assertTrue(executed.contains("middle"));
        assertTrue(executed.contains("newest"));
        assertEquals(1L, metrics.getDropped());
        assertEquals(0L, metrics.getQueued());
    }

    @Test(expected = IllegalStateException.class)
    public void rejectsSubmissionAfterClose() {
        AsyncDispatcher dispatcher = new AsyncDispatcher(new InternalMetrics());
        dispatcher.close();
        dispatcher.submit(new Runnable() {
            public void run() {
            }
        });
    }

    private static Runnable record(final List<String> executed, final String value) {
        return new Runnable() {
            public void run() {
                executed.add(value);
            }
        };
    }
}

