package oppex

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// defaultRetryDelays is the fixed backoff schedule: five retries after the first
// attempt, doubling, without jitter. It is deliberately not configurable.
var defaultRetryDelays = []time.Duration{
	500 * time.Millisecond,
	1000 * time.Millisecond,
	2000 * time.Millisecond,
	4000 * time.Millisecond,
	8000 * time.Millisecond,
}

// retryableStatuses is an explicit list rather than "any 5xx". Widening it is a
// deliberate policy change, not an incidental one.
var retryableStatuses = map[int]bool{429: true, 500: true, 502: true, 503: true, 504: true}

func isRetryableStatus(statusCode int) bool { return retryableStatuses[statusCode] }

// retry runs operation until it succeeds, fails with a non-retryable error, or
// exhausts delays. Only the final failure is returned; individual attempts are
// never logged, so a saturated Oppex API cannot flood the host's logs.
//
// delays is a parameter rather than a direct read of defaultRetryDelays so tests
// can run the real loop without waiting out the production schedule.
func retry[T any](ctx context.Context, delays []time.Duration, operation func() (T, error)) (T, error) {
	var zero T
	for attempt := 0; ; attempt++ {
		result, err := operation()
		if err == nil {
			return result, nil
		}

		var failure *IncidentError
		if !errors.As(err, &failure) || !failure.Retryable || attempt >= len(delays) {
			return zero, withAttemptCount(err, attempt+1)
		}
		if err := sleep(ctx, delays[attempt]); err != nil {
			return zero, err
		}
	}
}

// withAttemptCount annotates only a failure that never reached a status line, so
// an HTTP failure keeps the message its status already explains.
func withAttemptCount(err error, attempts int) error {
	var failure *IncidentError
	if attempts < 2 || !errors.As(err, &failure) || failure.StatusCode != NoStatusCode {
		return err
	}
	annotated := *failure
	annotated.Message = fmt.Sprintf("%s (after %d attempts)", failure.Message, attempts)
	return &annotated
}

// sleep waits for the backoff delay, abandoning it if the caller's context ends
// first. A cancelled context is reported as a non-retryable delivery failure so
// callers see one error type from every post.
func sleep(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return &IncidentError{
			Message:    "incident delivery was cancelled during retry",
			StatusCode: NoStatusCode,
			Err:        ctx.Err(),
		}
	}
}
