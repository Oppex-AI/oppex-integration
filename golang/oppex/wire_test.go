package oppex

import (
	"errors"
	"strings"
	"testing"
)

func TestSerializeOmitsAbsentOptionalFields(t *testing.T) {
	payload, err := serializeRequest(IncidentRequest{
		Title: "title", Source: "source", Severity: SeverityHigh, Priority: 2, SrcTimestamp: 1700000000000,
	}, "")
	if err != nil {
		t.Fatalf("serializeRequest() returned %v", err)
	}

	got := strings.TrimSpace(string(payload))
	want := `{"title":"title","source":"source","severity":4,"priority":2,"srcTimestamp":1700000000000}`
	if got != want {
		t.Errorf("payload = %s, want %s", got, want)
	}
}

func TestSerializeUsesDetailsJSONFieldName(t *testing.T) {
	payload, err := serializeRequest(IncidentRequest{
		Title: "title", Source: "source", Severity: SeverityLow, Priority: 1, SrcTimestamp: 1,
		Component: "api", Group: "payments", Type: "latency", Details: `{"p99":1200}`,
	}, "resolved-service-key")
	if err != nil {
		t.Fatalf("serializeRequest() returned %v", err)
	}

	got := strings.TrimSpace(string(payload))
	want := `{"serviceKey":"resolved-service-key","title":"title","source":"source","severity":2,` +
		`"priority":1,"srcTimestamp":1,"component":"api","group":"payments","type":"latency",` +
		`"detailsJSON":"{\"p99\":1200}"}`
	if got != want {
		t.Errorf("payload = %s, want %s", got, want)
	}
}

func TestParseResponseReadsEnvelope(t *testing.T) {
	response, err := parseResponse(200, []byte(`{"success":true,"code":201,"message":"created","data":"INC-1"}`))
	if err != nil {
		t.Fatalf("parseResponse() returned %v", err)
	}
	if !response.Successful || response.Code != 201 || response.Message != "created" || response.IncidentID != "INC-1" {
		t.Errorf("parseResponse() = %+v", response)
	}
}

func TestParseResponseFallsBackToHTTPStatus(t *testing.T) {
	response, err := parseResponse(202, []byte("   "))
	if err != nil {
		t.Fatalf("parseResponse() returned %v", err)
	}
	if !response.Successful || response.Code != 202 || response.IncidentID != "" {
		t.Errorf("parseResponse() = %+v", response)
	}
}

func TestParseResponseRejectsNonJSONWithoutEchoingIt(t *testing.T) {
	_, err := parseResponse(502, []byte("<html>X-API-KEY: super-secret</html>"))

	var failure *IncidentError
	if !errors.As(err, &failure) {
		t.Fatalf("parseResponse() = %v, want an *IncidentError", err)
	}
	if strings.Contains(failure.Error(), "super-secret") {
		t.Errorf("the error echoed the response body: %v", failure)
	}
}
