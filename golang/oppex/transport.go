package oppex

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"time"
)

// DefaultEndpoint is the Oppex incident endpoint every client posts to.
const DefaultEndpoint = "https://api.oppex.ai/api/v1/incident/post"

const (
	connectTimeout = 3 * time.Second
	socketTimeout  = 5 * time.Second
	// attemptTimeout bounds a whole attempt so a server that trickles bytes
	// forever cannot hold a delivery open past the sum of its phase timeouts.
	attemptTimeout = connectTimeout + socketTimeout
	maxConnections = 20
	// maxResponseBytes caps how much of a response body is read. The API
	// returns a small envelope; anything larger is a misbehaving proxy, and
	// reading it in full would let that proxy dictate this client's memory use.
	maxResponseBytes = 1 << 20
)

// endpoint resolves the target URL. The override exists so tests can point the
// full delivery path at a loopback server; it is deliberately not client
// configuration, which would add a public knob that exists only to ease testing.
func endpoint() string {
	if override := os.Getenv("OPPEX_TEST_ENDPOINT_URL"); override != "" {
		return override
	}
	return DefaultEndpoint
}

// transport is the HTTP adapter. It owns the connection pool, so closing a client
// releases the sockets that client opened and no others.
type transport struct {
	apiKey     string
	endpoint   string
	httpClient *http.Client
}

func newTransport(apiKey string) *transport {
	// Go has no single "socket timeout" knob. ResponseHeaderTimeout is the
	// closest equivalent to the read timeout the other SDKs configure, and the
	// client-wide Timeout is the backstop for a response that never ends.
	httpTransport := &http.Transport{
		DialContext:           (&net.Dialer{Timeout: connectTimeout}).DialContext,
		TLSHandshakeTimeout:   connectTimeout,
		ResponseHeaderTimeout: socketTimeout,
		MaxConnsPerHost:       maxConnections,
		MaxIdleConns:          maxConnections,
		MaxIdleConnsPerHost:   maxConnections,
	}
	return &transport{
		apiKey:   apiKey,
		endpoint: endpoint(),
		httpClient: &http.Client{
			Transport: httpTransport,
			Timeout:   attemptTimeout,
		},
	}
}

// send performs one attempt. Every failure it returns is an [IncidentError] whose
// Retryable field already carries the retry decision, so the retry loop never has
// to inspect a transport-specific error type.
func (t *transport) send(ctx context.Context, payload []byte) (IncidentResponse, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, t.endpoint, bytes.NewReader(payload))
	if err != nil {
		return IncidentResponse{}, &IncidentError{
			Message:    "building the incident request",
			StatusCode: NoStatusCode,
			Err:        err,
		}
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-API-KEY", t.apiKey)

	response, err := t.httpClient.Do(request)
	if err != nil {
		// No status line was ever received, so the failure is transport-level
		// and retryable regardless of what the underlying error was.
		return IncidentResponse{}, &IncidentError{
			Message:    "incident delivery failed before a response was received",
			StatusCode: NoStatusCode,
			Retryable:  true,
			Err:        err,
		}
	}
	defer response.Body.Close()

	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return IncidentResponse{}, &IncidentError{
			Message:    "reading the Oppex response body",
			StatusCode: NoStatusCode,
			Retryable:  true,
			Err:        err,
		}
	}

	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return parseResponse(response.StatusCode, body)
	}
	return IncidentResponse{}, statusFailure(response.StatusCode, body)
}

// statusFailure turns a non-2xx response into a delivery failure, adding the
// API's own message when the body carries one.
func statusFailure(statusCode int, body []byte) error {
	message := fmt.Sprintf("Oppex returned HTTP %d", statusCode)
	if parsed, err := parseResponse(statusCode, body); err == nil && parsed.Message != "" {
		message = fmt.Sprintf("%s: %s", message, parsed.Message)
	}
	return &IncidentError{
		Message:    message,
		StatusCode: statusCode,
		Retryable:  isRetryableStatus(statusCode),
	}
}

func (t *transport) close() {
	t.httpClient.CloseIdleConnections()
}
