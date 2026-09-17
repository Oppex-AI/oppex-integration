package oppex

import (
	"log/slog"
	"sync"
	"time"
)

const dropLogInterval = time.Minute

// rateLimitedDropLogger counts every dropped incident but emits at most one
// summary per interval. A saturated queue drops continuously, so logging each
// drop would replace one overload with another.
type rateLimitedDropLogger struct {
	logger   *slog.Logger
	interval time.Duration
	now      func() time.Time

	mu        sync.Mutex
	dropped   int
	startedAt time.Time
}

func newRateLimitedDropLogger(logger *slog.Logger, interval time.Duration, now func() time.Time) *rateLimitedDropLogger {
	return &rateLimitedDropLogger{logger: logger, interval: interval, now: now, startedAt: now()}
}

func (d *rateLimitedDropLogger) recordDrop() {
	d.mu.Lock()
	d.dropped++
	current := d.now()
	if current.Sub(d.startedAt) < d.interval {
		d.mu.Unlock()
		return
	}
	dropped := d.dropped
	d.dropped = 0
	d.startedAt = current
	d.mu.Unlock()

	if dropped > 0 {
		d.logger.Warn("oppex: dropped queued incidents", slog.Int("dropped", dropped),
			slog.Duration("interval", d.interval))
	}
}
