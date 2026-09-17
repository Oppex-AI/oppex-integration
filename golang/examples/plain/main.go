// Command plain posts one incident synchronously and one asynchronously.
//
// Run it with real credentials:
//
//	OPPEX_API_KEY=... OPPEX_SERVICE_KEY=... go run ./examples/plain
package main

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/Oppex-AI/oppex-integration/golang/oppex"
)

func main() {
	client, err := oppex.New(oppex.Config{
		APIKey:     os.Getenv("OPPEX_API_KEY"),
		ServiceKey: os.Getenv("OPPEX_SERVICE_KEY"),
	})
	if err != nil {
		log.Fatalf("creating the Oppex client: %v", err)
	}
	// Closing drains queued asynchronous incidents for up to ten seconds.
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	response, err := client.Post(ctx, oppex.IncidentRequest{
		Title:     "Checkout latency breached the SLO",
		Source:    "checkout-api",
		Severity:  oppex.SeverityHigh,
		Priority:  2,
		Component: "payments",
		Group:     "platform",
		Type:      "latency",
		Details:   `{"p99Millis":1200,"threshold":800}`,
	})
	if err != nil {
		log.Fatalf("posting the incident: %v", err)
	}
	log.Printf("incident %s created (code %d)", response.IncidentID, response.Code)

	// Fire-and-forget. Validation still fails fast here; a delivery failure after
	// this point is logged rather than returned.
	if err := client.PostAsync(oppex.IncidentRequest{
		Title:    "Background job queue is backing up",
		Source:   "worker",
		Severity: oppex.SeverityLow,
	}); err != nil {
		log.Printf("queueing the incident: %v", err)
	}
}
