// Command consumer exercises the published Go SDK surface from outside its own
// module, mirroring .github/smoke/java/ExternalConsumer.java: only supported
// API, network-free, and a fixed sentinel the workflow greps for.
//
// "Network-free" does not mean "never attempts an HTTP call". Port 1 on loopback
// refuses the connection immediately, so a fully valid request pointed at it
// still reaches the real transport and fails there, genuinely exercising that
// path without touching the actual Oppex service.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"

	"github.com/Oppex-AI/oppex-integration/golang/oppex"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("EXTERNAL_CONSUMER_OK go=%s\n", runtime.Version())
}

func run() error {
	if oppex.DefaultEndpoint != "https://api.oppex.ai/api/v1/incident/post" {
		return fmt.Errorf("unexpected endpoint %q", oppex.DefaultEndpoint)
	}
	if oppex.SeverityMedium != 3 {
		return fmt.Errorf("unexpected severity mapping %d", oppex.SeverityMedium)
	}

	if err := checkRealTransportFailure(); err != nil {
		return err
	}
	if err := checkValidation(); err != nil {
		return err
	}
	return checkServiceRouting()
}

// checkRealTransportFailure reaches the actual transport and requires it to fail
// with a connection refusal, not a validation error.
func checkRealTransportFailure() error {
	os.Setenv("OPPEX_TEST_ENDPOINT_URL", "http://127.0.0.1:1")
	defer os.Unsetenv("OPPEX_TEST_ENDPOINT_URL")

	client, err := oppex.New(oppex.Config{APIKey: "wrong-api-key", ServiceKey: "wrong-service-key"})
	if err != nil {
		return fmt.Errorf("creating the client: %w", err)
	}
	defer client.Close()

	_, err = client.Post(context.Background(), oppex.IncidentRequest{
		Title: "valid title", Source: "github-actions", Severity: oppex.SeverityMedium,
	})

	var failure *oppex.IncidentError
	if !errors.As(err, &failure) {
		return fmt.Errorf("a refused connection must be an *oppex.IncidentError, got %v", err)
	}
	if failure.StatusCode != oppex.NoStatusCode {
		return fmt.Errorf("a refused connection must carry NoStatusCode, got %d", failure.StatusCode)
	}
	// Five retries plus the first attempt, so the message carries the count.
	if !strings.Contains(failure.Error(), "attempts") {
		return fmt.Errorf("an exhausted network failure must report its attempts: %v", failure)
	}
	return nil
}

func checkValidation() error {
	client, err := oppex.New(oppex.Config{APIKey: "external-consumer-api-key", ServiceKey: "k"})
	if err != nil {
		return fmt.Errorf("creating the client: %w", err)
	}
	defer client.Close()

	// A blank title fails before any HTTP attempt.
	_, err = client.Post(context.Background(), oppex.IncidentRequest{
		Title: "", Source: "github-actions", Severity: oppex.SeverityMedium,
	})
	if !errors.Is(err, oppex.ErrInvalidRequest) {
		return fmt.Errorf("a blank title must be rejected, got %v", err)
	}

	if err := client.Close(); err != nil {
		return fmt.Errorf("closing the client: %w", err)
	}
	if _, err := client.Post(context.Background(), oppex.IncidentRequest{
		Title: "t", Source: "github-actions", Severity: oppex.SeverityLow,
	}); !errors.Is(err, oppex.ErrClientClosed) {
		return fmt.Errorf("a post after Close must report a closed client, got %v", err)
	}
	return nil
}

// checkServiceRouting exercises the precondition, which fails before any network
// call.
func checkServiceRouting() error {
	client, err := oppex.New(oppex.Config{APIKey: "external-consumer-api-key"})
	if err != nil {
		return fmt.Errorf("creating the client: %w", err)
	}
	defer client.Close()

	_, err = client.PostWithServiceRouting(context.Background(), oppex.IncidentRequest{
		Title: "Service routing test", Source: "github-actions",
		Severity: oppex.SeverityLow, ServiceKey: "external-consumer-service-key",
	})
	if !errors.Is(err, oppex.ErrInvalidRequest) {
		return fmt.Errorf("service routing must refuse a request service key, got %v", err)
	}
	return nil
}
