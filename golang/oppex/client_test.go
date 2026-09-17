package oppex

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// recordingServer is a loopback stand-in for the Oppex API. Tests never reach the
// real service; only the local server started here.
type recordingServer struct {
	server   *httptest.Server
	mu       sync.Mutex
	payloads []map[string]any
	headers  []http.Header
}

func newRecordingServer(t *testing.T, handler func(attempt int, w http.ResponseWriter)) *recordingServer {
	t.Helper()
	recorder := &recordingServer{}
	recorder.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("the client sent a body that is not JSON: %v", err)
		}
		recorder.mu.Lock()
		recorder.payloads = append(recorder.payloads, payload)
		recorder.headers = append(recorder.headers, r.Header.Clone())
		attempt := len(recorder.payloads)
		recorder.mu.Unlock()

		handler(attempt, w)
	}))
	t.Cleanup(recorder.server.Close)
	t.Setenv("OPPEX_TEST_ENDPOINT_URL", recorder.server.URL)
	return recorder
}

func (r *recordingServer) attempts() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.payloads)
}

func (r *recordingServer) lastPayload(t *testing.T) map[string]any {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.payloads) == 0 {
		t.Fatal("the client sent no request")
	}
	return r.payloads[len(r.payloads)-1]
}

func respondCreated(_ int, w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"success":true,"code":200,"message":"created","data":"INC-42"}`))
}

func newTestClient(t *testing.T, config Config) *Client {
	t.Helper()
	config.Logger = quietLogger()
	client, err := New(config)
	if err != nil {
		t.Fatalf("New() returned %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func TestNewRejectsABlankAPIKey(t *testing.T) {
	for _, apiKey := range []string{"", "   "} {
		if _, err := New(Config{APIKey: apiKey}); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("New(%q) = %v, want an ErrInvalidRequest", apiKey, err)
		}
	}
}

func TestPostSendsTheAgreedPayloadAndHeader(t *testing.T) {
	server := newRecordingServer(t, respondCreated)
	client := newTestClient(t, Config{APIKey: "api-key", ServiceKey: "client-service-key"})

	response, err := client.Post(t.Context(), IncidentRequest{
		Title: "Checkout latency", Source: "checkout-api", Severity: SeverityHigh,
		SrcTimestamp: 1700000000000, Details: `{"p99":1200}`,
	})
	if err != nil {
		t.Fatalf("Post() returned %v", err)
	}
	if !response.Successful || response.IncidentID != "INC-42" || response.Message != "created" {
		t.Errorf("Post() = %+v", response)
	}

	payload := server.lastPayload(t)
	want := map[string]any{
		"serviceKey": "client-service-key", "title": "Checkout latency", "source": "checkout-api",
		"severity": float64(4), "priority": float64(1), "srcTimestamp": float64(1700000000000),
		"detailsJSON": `{"p99":1200}`,
	}
	for field, value := range want {
		if payload[field] != value {
			t.Errorf("payload[%q] = %v, want %v", field, payload[field], value)
		}
	}
	for _, absent := range []string{"component", "group", "type"} {
		if _, present := payload[absent]; present {
			t.Errorf("payload carried an absent optional field %q", absent)
		}
	}

	server.mu.Lock()
	defer server.mu.Unlock()
	if got := server.headers[0].Get("X-API-KEY"); got != "api-key" {
		t.Errorf("X-API-KEY = %q, want %q", got, "api-key")
	}
}

func TestRequestServiceKeyOverridesTheClients(t *testing.T) {
	server := newRecordingServer(t, respondCreated)
	client := newTestClient(t, Config{APIKey: "api-key", ServiceKey: "client-service-key"})

	if _, err := client.Post(t.Context(), IncidentRequest{
		Title: "title", Source: "source", Severity: SeverityLow, ServiceKey: "request-service-key",
	}); err != nil {
		t.Fatalf("Post() returned %v", err)
	}
	if got := server.lastPayload(t)["serviceKey"]; got != "request-service-key" {
		t.Errorf("serviceKey = %v, want the request's own key", got)
	}
}

func TestPostRequiresAServiceKeySomewhere(t *testing.T) {
	newRecordingServer(t, respondCreated)
	client := newTestClient(t, Config{APIKey: "api-key"})

	_, err := client.Post(t.Context(), IncidentRequest{Title: "title", Source: "source", Severity: SeverityLow})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("Post() = %v, want an ErrInvalidRequest", err)
	}
}

func TestServiceRoutingOmitsTheServiceKey(t *testing.T) {
	server := newRecordingServer(t, respondCreated)
	client := newTestClient(t, Config{APIKey: "api-key", ServiceKey: "client-service-key"})

	if _, err := client.PostWithServiceRouting(t.Context(), IncidentRequest{
		Title: "title", Source: "source", Severity: SeverityLow,
	}); err != nil {
		t.Fatalf("PostWithServiceRouting() returned %v", err)
	}
	if _, present := server.lastPayload(t)["serviceKey"]; present {
		t.Error("service routing must omit serviceKey entirely")
	}
}

func TestServiceRoutingRefusesARequestServiceKey(t *testing.T) {
	newRecordingServer(t, respondCreated)
	client := newTestClient(t, Config{APIKey: "api-key"})

	_, err := client.PostWithServiceRouting(t.Context(), IncidentRequest{
		Title: "title", Source: "source", Severity: SeverityLow, ServiceKey: "request-service-key",
	})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("PostWithServiceRouting() = %v, want an ErrInvalidRequest", err)
	}
}

func TestPostRetriesRetryableStatuses(t *testing.T) {
	server := newRecordingServer(t, func(attempt int, w http.ResponseWriter) {
		if attempt < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		respondCreated(attempt, w)
	})
	client := newTestClient(t, Config{APIKey: "api-key", ServiceKey: "service-key"})
	// The production schedule would make this test wait 1.5s before succeeding.
	client.retryDelays = testDelays

	response, err := client.Post(t.Context(), IncidentRequest{Title: "title", Source: "source", Severity: SeverityLow})
	if err != nil {
		t.Fatalf("Post() returned %v", err)
	}
	if !response.Successful || server.attempts() != 3 {
		t.Errorf("Post() = %+v after %d attempts", response, server.attempts())
	}
}

func TestPostFailsImmediatelyOnANonRetryableStatus(t *testing.T) {
	server := newRecordingServer(t, func(_ int, w http.ResponseWriter) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"success":false,"message":"invalid api key"}`))
	})
	client := newTestClient(t, Config{APIKey: "api-key", ServiceKey: "service-key"})
	client.retryDelays = testDelays

	_, err := client.Post(t.Context(), IncidentRequest{Title: "title", Source: "source", Severity: SeverityLow})

	var failure *IncidentError
	if !errors.As(err, &failure) {
		t.Fatalf("Post() = %v, want an *IncidentError", err)
	}
	if failure.StatusCode != http.StatusUnauthorized || failure.Retryable {
		t.Errorf("failure = %+v, want a non-retryable 401", failure)
	}
	if server.attempts() != 1 {
		t.Errorf("attempts = %d, want exactly one", server.attempts())
	}
}

func TestPostAsyncDeliversAndValidatesOnTheCallingGoroutine(t *testing.T) {
	delivered := make(chan struct{}, 1)
	newRecordingServer(t, func(attempt int, w http.ResponseWriter) {
		respondCreated(attempt, w)
		delivered <- struct{}{}
	})
	client := newTestClient(t, Config{APIKey: "api-key", ServiceKey: "service-key"})

	if err := client.PostAsync(IncidentRequest{Title: "", Source: "source", Severity: SeverityLow}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("PostAsync() = %v, want a validation failure on the calling goroutine", err)
	}
	if err := client.PostAsync(IncidentRequest{Title: "title", Source: "source", Severity: SeverityLow}); err != nil {
		t.Fatalf("PostAsync() returned %v", err)
	}

	select {
	case <-delivered:
	case <-time.After(5 * time.Second):
		t.Fatal("PostAsync() never delivered the incident")
	}
}

func TestEveryPostFailsOnAClosedClient(t *testing.T) {
	newRecordingServer(t, respondCreated)
	client := newTestClient(t, Config{APIKey: "api-key", ServiceKey: "service-key"})
	if err := client.Close(); err != nil {
		t.Fatalf("Close() returned %v", err)
	}

	request := IncidentRequest{Title: "title", Source: "source", Severity: SeverityLow}
	if _, err := client.Post(t.Context(), request); !errors.Is(err, ErrClientClosed) {
		t.Errorf("Post() = %v, want ErrClientClosed", err)
	}
	if err := client.PostAsync(request); !errors.Is(err, ErrClientClosed) {
		t.Errorf("PostAsync() = %v, want ErrClientClosed", err)
	}
	if err := client.Close(); err != nil {
		t.Errorf("a second Close() returned %v", err)
	}
}

func TestClientIsSafeForConcurrentUse(t *testing.T) {
	var delivered atomic.Int64
	newRecordingServer(t, func(attempt int, w http.ResponseWriter) {
		delivered.Add(1)
		respondCreated(attempt, w)
	})
	client := newTestClient(t, Config{APIKey: "api-key", ServiceKey: "service-key"})

	var callers sync.WaitGroup
	for range 16 {
		callers.Add(1)
		go func() {
			defer callers.Done()
			if _, err := client.Post(t.Context(), IncidentRequest{
				Title: "title", Source: "source", Severity: SeverityLow,
			}); err != nil {
				t.Errorf("Post() returned %v", err)
			}
		}()
	}
	callers.Wait()

	if delivered.Load() != 16 {
		t.Errorf("delivered %d incidents, want 16", delivered.Load())
	}
}
