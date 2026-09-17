package oppex

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

var testDelays = []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond, time.Millisecond, time.Millisecond}

func TestRetryableStatusList(t *testing.T) {
	for _, status := range []int{429, 500, 502, 503, 504} {
		if !isRetryableStatus(status) {
			t.Errorf("status %d must be retryable", status)
		}
	}
	for _, status := range []int{400, 401, 403, 404, 409, 422, 501, 505} {
		if isRetryableStatus(status) {
			t.Errorf("status %d must not be retryable", status)
		}
	}
}

func TestRetryStopsAtTheFirstSuccess(t *testing.T) {
	attempts := 0
	response, err := retry(t.Context(), testDelays, func() (IncidentResponse, error) {
		attempts++
		if attempts < 3 {
			return IncidentResponse{}, &IncidentError{Message: "503", StatusCode: 503, Retryable: true}
		}
		return IncidentResponse{Successful: true}, nil
	})
	if err != nil {
		t.Fatalf("retry() returned %v", err)
	}
	if !response.Successful || attempts != 3 {
		t.Errorf("response = %+v after %d attempts", response, attempts)
	}
}

func TestRetrySkipsNonRetryableFailures(t *testing.T) {
	attempts := 0
	_, err := retry(t.Context(), testDelays, func() (IncidentResponse, error) {
		attempts++
		return IncidentResponse{}, &IncidentError{Message: "401", StatusCode: 401}
	})
	if err == nil || attempts != 1 {
		t.Fatalf("retry() = %v after %d attempts, want one attempt and a failure", err, attempts)
	}
}

func TestRetryExhaustsTheSchedule(t *testing.T) {
	attempts := 0
	_, err := retry(t.Context(), testDelays, func() (IncidentResponse, error) {
		attempts++
		return IncidentResponse{}, &IncidentError{Message: "503", StatusCode: 503, Retryable: true}
	})
	if err == nil {
		t.Fatal("retry() = nil, want a failure")
	}
	if attempts != len(testDelays)+1 {
		t.Errorf("attempts = %d, want %d", attempts, len(testDelays)+1)
	}
	if strings.Contains(err.Error(), "attempts") {
		t.Errorf("an HTTP failure must keep its original message: %v", err)
	}
}

func TestRetryAnnotatesOnlyNetworkFailures(t *testing.T) {
	_, err := retry(t.Context(), testDelays, func() (IncidentResponse, error) {
		return IncidentResponse{}, &IncidentError{Message: "connection refused", StatusCode: NoStatusCode, Retryable: true}
	})
	if err == nil || !strings.Contains(err.Error(), "after 6 attempts") {
		t.Fatalf("retry() = %v, want an attempt count", err)
	}
}

func TestRetryStopsOnContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	_, err := retry(ctx, testDelays, func() (IncidentResponse, error) {
		return IncidentResponse{}, &IncidentError{Message: "503", StatusCode: 503, Retryable: true}
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("retry() = %v, want a cancellation", err)
	}
}

func TestProductionDelaysDoubleFromHalfASecond(t *testing.T) {
	want := []time.Duration{500 * time.Millisecond, time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second}
	if len(defaultRetryDelays) != len(want) {
		t.Fatalf("defaultRetryDelays has %d entries, want %d", len(defaultRetryDelays), len(want))
	}
	for i, delay := range defaultRetryDelays {
		if delay != want[i] {
			t.Errorf("defaultRetryDelays[%d] = %s, want %s", i, delay, want[i])
		}
	}
}
