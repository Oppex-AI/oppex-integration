package dev.oppex.sdk.internal.async;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;

import static org.junit.Assert.assertEquals;

public class RateLimitedDropLoggerTest {
    @Test
    public void logsOneSummaryPerInterval() {
        final long[] now = {1000L};
        final List<LogRecord> records = new ArrayList<LogRecord>();
        Logger logger = Logger.getLogger("drop-summary-test");
        logger.setUseParentHandlers(false);
        logger.setLevel(Level.ALL);
        logger.addHandler(new Handler() {
            public void publish(LogRecord record) {
                records.add(record);
            }

            public void flush() {
            }

            public void close() {
            }
        });
        RateLimitedDropLogger dropLogger = new RateLimitedDropLogger(logger, new RateLimitedDropLogger.Clock() {
            public long currentTimeMillis() {
                return now[0];
            }
        }, 60000L);

        dropLogger.recordDrop();
        dropLogger.recordDrop();
        assertEquals(0, records.size());

        now[0] += 60000L;
        dropLogger.recordDrop();
        assertEquals(1, records.size());
        assertEquals(Long.valueOf(3L), records.get(0).getParameters()[0]);
    }
}

