package oppex

// IncidentResponse is the result of a delivered incident.
type IncidentResponse struct {
	// Successful reports the API's own success flag, defaulting to whether the
	// HTTP status was 2xx when the body does not carry one.
	Successful bool
	// Code is the API's own code, defaulting to the HTTP status.
	Code int
	// Message is the API's human-readable message, empty when absent.
	Message string
	// IncidentID is the created incident's identifier, empty when absent.
	IncidentID string
}
