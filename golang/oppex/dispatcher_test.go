package oppex

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestDispatcherRunsSubmittedWork(t *testing.T) {
	d := newDispatcher(quietLogger(), 2, 10)
	var done sync.WaitGroup
	var ran atomic.Int64

	done.Add(5)
	for range 5 {
		d.submit(func(context.Context) {
			ran.Add(1)
			done.Done()
		})
	}
	done.Wait()
	d.close(time.Second)

	if ran.Load() != 5 {
		t.Errorf("ran %d tasks, want 5", ran.Load())
	}
}

func TestDispatcherDropsTheOldestWhenFull(t *testing.T) {
	// One worker, blocked on a gate, so everything else has to queue.
	d := newDispatcher(quietLogger(), 1, 2)
	gate := make(chan struct{})
	started := make(chan struct{})

	d.submit(func(context.Context) {
		close(started)
		<-gate
	})
	<-started

	var mu sync.Mutex
	var ran []string
	record := func(name string) task {
		return func(context.Context) {
			mu.Lock()
			defer mu.Unlock()
			ran = append(ran, name)
		}
	}
	d.submit(record("oldest"))
	d.submit(record("middle"))
	d.submit(record("newest"))

	close(gate)
	d.close(2 * time.Second)

	mu.Lock()
	defer mu.Unlock()
	if len(ran) != 2 {
		t.Fatalf("ran %v, want exactly two queued tasks", ran)
	}
	if ran[0] == "oldest" {
		t.Errorf("ran %v, want the oldest queued task dropped", ran)
	}
}

func TestDispatcherRefusesWorkAfterClose(t *testing.T) {
	d := newDispatcher(quietLogger(), 1, 1)
	d.close(time.Second)

	if d.submit(func(context.Context) {}) {
		t.Error("submit() accepted work after close")
	}
}

func TestDispatcherCloseIsIdempotent(t *testing.T) {
	d := newDispatcher(quietLogger(), 1, 1)
	d.close(time.Second)
	d.close(time.Second)
}

func TestDispatcherAbandonsWorkThatOutlastsTheDrainTimeout(t *testing.T) {
	d := newDispatcher(quietLogger(), 1, 10)
	release := make(chan struct{})
	defer close(release)
	started := make(chan struct{})

	d.submit(func(context.Context) {
		close(started)
		<-release
	})
	<-started
	var ran atomic.Int64
	d.submit(func(context.Context) { ran.Add(1) })

	closed := make(chan struct{})
	go func() {
		d.close(50 * time.Millisecond)
		close(closed)
	}()

	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("close() did not give up on a task that outlasted the drain timeout")
	}
	if ran.Load() != 0 {
		t.Error("close() ran a task it should have abandoned")
	}
}

func TestRateLimitedDropLoggerSummarizesPerInterval(t *testing.T) {
	current := time.Unix(0, 0)
	logger := newRateLimitedDropLogger(quietLogger(), time.Minute, func() time.Time { return current })

	for range 10 {
		logger.recordDrop()
	}
	logger.mu.Lock()
	dropped := logger.dropped
	logger.mu.Unlock()
	if dropped != 10 {
		t.Fatalf("dropped = %d within the interval, want 10 held back", dropped)
	}

	current = current.Add(2 * time.Minute)
	logger.recordDrop()

	logger.mu.Lock()
	defer logger.mu.Unlock()
	if logger.dropped != 0 {
		t.Errorf("dropped = %d after the interval elapsed, want a flushed counter", logger.dropped)
	}
}
