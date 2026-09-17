package oppex

import (
	"strings"
	"time"
	"unicode/utf8"
)

// maxSourceLength caps source at 255 characters, counted as Unicode code points.
const maxSourceLength = 255

// IncidentRequest is a single incident submission.
//
// Title, Source and Severity are required. Every other field is optional and its
// zero value means "absent": an omitted field is left out of the payload rather
// than sent as null. Priority defaults to 1 and SrcTimestamp defaults to the
// current time.
type IncidentRequest struct {
	// Title is the incident headline. Required, non-blank.
	Title string
	// Source identifies the emitting system. Required, non-blank, at most 255
	// characters.
	Source string
	// Severity is the Oppex scale from [SeverityLowest] to [SeverityCritical].
	// Required.
	Severity Severity
	// Priority is 1 through 5. Zero means 1.
	Priority int
	// SrcTimestamp is milliseconds since the Unix epoch. Zero means now.
	SrcTimestamp int64
	// ServiceKey overrides the service key configured on the client.
	ServiceKey string
	Component  string
	Group      string
	Type       string
	// Details is JSON text sent in the wire-level detailsJSON field.
	Details string
}

// Validate reports whether the request can be delivered, without normalizing it.
// Every post validates on the calling goroutine before doing any work, so calling
// this first is only useful when a caller wants to reject bad input earlier.
//
// Every failure wraps [ErrInvalidRequest].
func (r IncidentRequest) Validate() error {
	_, err := r.normalize()
	return err
}

// normalize validates the request and applies the documented defaults. It is the
// single place defaults are resolved, so synchronous and asynchronous posts can
// never disagree about what was sent.
func (r IncidentRequest) normalize() (IncidentRequest, error) {
	if strings.TrimSpace(r.Title) == "" {
		return IncidentRequest{}, invalidf("title must not be blank")
	}
	if strings.TrimSpace(r.Source) == "" {
		return IncidentRequest{}, invalidf("source must not be blank")
	}
	if utf8.RuneCountInString(r.Source) > maxSourceLength {
		return IncidentRequest{}, invalidf("source must not exceed %d characters", maxSourceLength)
	}
	if !r.Severity.Valid() {
		return IncidentRequest{}, invalidf("severity must be between 1 and 5")
	}

	normalized := r
	if normalized.Priority == 0 {
		normalized.Priority = 1
	}
	if normalized.Priority < 1 || normalized.Priority > 5 {
		return IncidentRequest{}, invalidf("priority must be between 1 and 5")
	}
	if normalized.SrcTimestamp == 0 {
		normalized.SrcTimestamp = time.Now().UnixMilli()
	}
	if normalized.SrcTimestamp <= 0 {
		return IncidentRequest{}, invalidf("srcTimestamp must be greater than zero")
	}
	return normalized, nil
}
