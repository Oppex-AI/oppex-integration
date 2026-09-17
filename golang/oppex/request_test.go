package oppex

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func validRequest() IncidentRequest {
	return IncidentRequest{Title: "title", Source: "source", Severity: SeverityMedium}
}

func TestNormalizeAppliesDefaults(t *testing.T) {
	before := time.Now().UnixMilli()
	normalized, err := validRequest().normalize()
	if err != nil {
		t.Fatalf("normalize() returned %v", err)
	}
	if normalized.Priority != 1 {
		t.Errorf("Priority = %d, want the default 1", normalized.Priority)
	}
	if normalized.SrcTimestamp < before {
		t.Errorf("SrcTimestamp = %d, want at least %d", normalized.SrcTimestamp, before)
	}
}

func TestNormalizeKeepsExplicitValues(t *testing.T) {
	request := validRequest()
	request.Priority = 4
	request.SrcTimestamp = 1700000000000

	normalized, err := request.normalize()
	if err != nil {
		t.Fatalf("normalize() returned %v", err)
	}
	if normalized.Priority != 4 || normalized.SrcTimestamp != 1700000000000 {
		t.Errorf("normalize() altered explicit values: %+v", normalized)
	}
}

func TestValidateRejectsBadInput(t *testing.T) {
	cases := map[string]func(*IncidentRequest){
		"blank title":       func(r *IncidentRequest) { r.Title = "   " },
		"blank source":      func(r *IncidentRequest) { r.Source = "" },
		"long source":       func(r *IncidentRequest) { r.Source = strings.Repeat("a", 256) },
		"missing severity":  func(r *IncidentRequest) { r.Severity = 0 },
		"severity above 5":  func(r *IncidentRequest) { r.Severity = 6 },
		"priority above 5":  func(r *IncidentRequest) { r.Priority = 6 },
		"negative priority": func(r *IncidentRequest) { r.Priority = -1 },
		"negative time":     func(r *IncidentRequest) { r.SrcTimestamp = -1 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			request := validRequest()
			mutate(&request)
			err := request.Validate()
			if !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("Validate() = %v, want an ErrInvalidRequest", err)
			}
		})
	}
}

func TestValidateAcceptsExactly255Characters(t *testing.T) {
	request := validRequest()
	request.Source = strings.Repeat("a", 255)
	if err := request.Validate(); err != nil {
		t.Fatalf("Validate() = %v, want nil", err)
	}
}
