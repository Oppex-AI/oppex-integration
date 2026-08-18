package dev.oppex.sdk.internal.async;

import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;
import java.util.logging.Logger;

final class RateLimitedDropLogger {
    private static final long ONE_MINUTE_MILLIS = 60000L;

    interface Clock {
        long currentTimeMillis();
    }

    private final Logger logger;
    private final Clock clock;
    private final long intervalMillis;
    private final AtomicLong intervalStartedAt;
    private final AtomicLong droppedInInterval = new AtomicLong();

    RateLimitedDropLogger(Logger logger) {
        this(logger, new Clock() {
            public long currentTimeMillis() {
                return System.currentTimeMillis();
            }
        }, ONE_MINUTE_MILLIS);
    }

    RateLimitedDropLogger(Logger logger, Clock clock, long intervalMillis) {
        this.logger = logger;
        this.clock = clock;
        this.intervalMillis = intervalMillis;
        this.intervalStartedAt = new AtomicLong(clock.currentTimeMillis());
    }

    void recordDrop() {
        droppedInInterval.incrementAndGet();
        long now = clock.currentTimeMillis();
        long started = intervalStartedAt.get();
        if (now - started < intervalMillis || !intervalStartedAt.compareAndSet(started, now)) {
            return;
        }
        long count = droppedInInterval.getAndSet(0L);
        if (count > 0L) {
            logger.log(Level.WARNING, "Dropped {0} incidents in the last minute.", Long.valueOf(count));
        }
    }
}

