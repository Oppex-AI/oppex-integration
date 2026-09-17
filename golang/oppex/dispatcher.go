package oppex

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

const (
	queueCapacity     = 5000
	workerCount       = 2
	closeDrainTimeout = 10 * time.Second
)

// task is one queued asynchronous delivery. The context it receives is cancelled
// when close gives up waiting, which is how an in-flight HTTP request is
// abandoned: a goroutine cannot be interrupted the way a Java worker thread can.
type task func(ctx context.Context)

// dispatcher delivers asynchronous incidents on a fixed number of goroutines,
// queueing the rest up to queueCapacity and dropping the oldest entry once full.
// Dropping the oldest keeps the newest incident, which is the one most likely to
// still matter, and submission never blocks the application.
type dispatcher struct {
	queue      chan task
	ctx        context.Context
	abandon    context.CancelFunc
	workers    sync.WaitGroup
	dropLogger *rateLimitedDropLogger
	logger     *slog.Logger

	mu     sync.Mutex
	closed bool
}

func newDispatcher(logger *slog.Logger, workers, capacity int) *dispatcher {
	ctx, abandon := context.WithCancel(context.Background())
	d := &dispatcher{
		queue:      make(chan task, capacity),
		ctx:        ctx,
		abandon:    abandon,
		dropLogger: newRateLimitedDropLogger(logger, dropLogInterval, time.Now),
		logger:     logger,
	}
	d.workers.Add(workers)
	for range workers {
		go d.work()
	}
	return d
}

func (d *dispatcher) work() {
	defer d.workers.Done()
	for queued := range d.queue {
		if d.ctx.Err() != nil {
			return
		}
		queued(d.ctx)
	}
}

// submit queues a task, evicting the oldest queued task when the queue is full.
// It reports whether the task was accepted; only a closed dispatcher refuses.
//
// The eviction and the send both happen under the mutex so two concurrent
// submissions cannot race for the slot that eviction just freed.
func (d *dispatcher) submit(queued task) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return false
	}

	select {
	case d.queue <- queued:
		return true
	default:
	}

	select {
	case <-d.queue:
		d.dropLogger.recordDrop()
	default:
	}
	select {
	case d.queue <- queued:
	default:
		// A worker refilled the slot first. The newest incident is the one
		// dropped in that case, which is still a bounded, counted loss.
		d.dropLogger.recordDrop()
	}
	return true
}

// close stops admitting work and drains what is already queued for up to timeout.
// Whatever is left is then abandoned by cancelling the shared task context, which
// aborts an in-flight request instead of waiting for it. close does not wait for
// the abandoned workers, so it always returns within timeout. It is idempotent
// and safe to call from any goroutine.
func (d *dispatcher) close(timeout time.Duration) {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return
	}
	d.closed = true
	close(d.queue)
	d.mu.Unlock()

	drained := make(chan struct{})
	go func() {
		d.workers.Wait()
		close(drained)
	}()

	select {
	case <-drained:
		d.abandon()
	case <-time.After(timeout):
		abandoned := len(d.queue)
		d.abandon()
		d.logger.Warn("oppex: abandoned pending incidents because close timed out",
			slog.Int("dropped", abandoned), slog.Duration("timeout", timeout))
	}
}
