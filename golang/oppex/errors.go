package oppex

import (
	"errors"
	"fmt"
)

// Sentinel errors. Callers classify failures with [errors.Is] rather than by
// matching message text.
var (
	// ErrInvalidRequest wraps every validation failure, on both the client
	// configuration and an individual incident.
	ErrInvalidRequest = errors.New("oppex: invalid request")
	// ErrClientClosed is returned by every post made after [Client.Close].
	ErrClientClosed = errors.New("oppex: client is closed")
)

// NoStatusCode is the [IncidentError.StatusCode] reported when a delivery failed
// before any HTTP status line was received.
const NoStatusCode = -1

// IncidentError is a delivery failure. It carries the HTTP status when one was
// received and whether the failure was eligible for retry.
type IncidentError struct {
	Message string
	// StatusCode is the HTTP status, or [NoStatusCode] when no response arrived.
	StatusCode int
	Retryable  bool
	// Err is the underlying transport or decoding failure, if any.
	Err error
}

func (e *IncidentError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("oppex: %s: %v", e.Message, e.Err)
	}
	return "oppex: " + e.Message
}

// Unwrap exposes the underlying failure to [errors.Is] and [errors.As].
func (e *IncidentError) Unwrap() error { return e.Err }

func invalidf(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidRequest, fmt.Sprintf(format, args...))
}
