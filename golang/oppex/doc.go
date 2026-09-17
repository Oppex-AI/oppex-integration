// Package oppex posts incidents to the Oppex incident API.
//
// Create one [Client] per application, share it across goroutines, and close it
// during application shutdown:
//
//	client, err := oppex.New(oppex.Config{APIKey: "api-key", ServiceKey: "service-key"})
//	if err != nil {
//		return err
//	}
//	defer client.Close()
//
//	_, err = client.Post(ctx, oppex.IncidentRequest{
//		Title:    "Checkout latency breached the SLO",
//		Source:   "checkout-api",
//		Severity: oppex.SeverityHigh,
//	})
//
// The service key is optional. A client built with only an API key posts with
// [Client.PostWithServiceRouting], which omits serviceKey from the payload so the
// API resolves the target service itself.
package oppex
