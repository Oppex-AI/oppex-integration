package dev.oppex.sdk.internal.retry;

import dev.oppex.sdk.exception.IncidentException;
import dev.oppex.sdk.internal.metrics.InternalMetrics;
import org.junit.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.assertEquals;

public class RetryExecutorTest {
    @Test
    public void retriesIoFailuresWithConfiguredBackoff() throws Exception {
        final int[] attempts = {0};
        final List<Long> sleeps = new ArrayList<Long>();
        InternalMetrics metrics = new InternalMetrics();
        RetryExecutor executor = new RetryExecutor(new long[] {5L, 10L, 20L}, new RetryExecutor.Sleeper() {
            public void sleep(long millis) {
                sleeps.add(Long.valueOf(millis));
            }
        }, metrics);

        String result = executor.execute(new RetryExecutor.Operation<String>() {
            public String execute() throws IOException {
                attempts[0]++;
                if (attempts[0] < 4) {
                    throw new IOException("connection reset");
                }
                return "ok";
            }
        });

        assertEquals("ok", result);
        assertEquals(4, attempts[0]);
        assertEquals(3, sleeps.size());
        assertEquals(Long.valueOf(5L), sleeps.get(0));
        assertEquals(Long.valueOf(10L), sleeps.get(1));
        assertEquals(Long.valueOf(20L), sleeps.get(2));
        assertEquals(3L, metrics.getRetried());
    }

    @Test
    public void retriesRetryableHttpFailures() throws Exception {
        final int[] attempts = {0};
        InternalMetrics metrics = new InternalMetrics();
        RetryExecutor executor = noWaitExecutor(metrics);

        String result = executor.execute(new RetryExecutor.Operation<String>() {
            public String execute() throws IncidentException {
                attempts[0]++;
                if (attempts[0] == 1) {
                    throw new IncidentException("unavailable", 503, true);
                }
                return "ok";
            }
        });

        assertEquals("ok", result);
        assertEquals(2, attempts[0]);
        assertEquals(1L, metrics.getRetried());
    }

    @Test
    public void doesNotRetryNonRetryableHttpFailure() {
        final int[] attempts = {0};
        InternalMetrics metrics = new InternalMetrics();
        RetryExecutor executor = noWaitExecutor(metrics);
        try {
            executor.execute(new RetryExecutor.Operation<String>() {
                public String execute() throws IncidentException {
                    attempts[0]++;
                    throw new IncidentException("unauthorized", 401, false);
                }
            });
        } catch (IncidentException expected) {
            assertEquals(401, expected.getStatusCode());
        }
        assertEquals(1, attempts[0]);
        assertEquals(0L, metrics.getRetried());
    }

    @Test
    public void stopsAfterFiveRetries() {
        final int[] attempts = {0};
        InternalMetrics metrics = new InternalMetrics();
        RetryExecutor executor = new RetryExecutor(new long[] {1L, 2L, 4L, 8L, 16L},
                new RetryExecutor.Sleeper() {
                    public void sleep(long millis) {
                    }
                }, metrics);
        try {
            executor.execute(new RetryExecutor.Operation<String>() {
                public String execute() throws IOException {
                    attempts[0]++;
                    throw new IOException("offline");
                }
            });
        } catch (IncidentException expected) {
            assertEquals(-1, expected.getStatusCode());
        }
        assertEquals(6, attempts[0]);
        assertEquals(5L, metrics.getRetried());
    }

    private static RetryExecutor noWaitExecutor(InternalMetrics metrics) {
        return new RetryExecutor(new long[] {1L}, new RetryExecutor.Sleeper() {
            public void sleep(long millis) {
            }
        }, metrics);
    }
}

