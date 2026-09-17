package oppex

import "testing"

func TestSeverityWireValues(t *testing.T) {
	expected := map[Severity]int{
		SeverityLowest: 1, SeverityLow: 2, SeverityMedium: 3, SeverityHigh: 4, SeverityCritical: 5,
	}
	for severity, value := range expected {
		if int(severity) != value {
			t.Errorf("severity %s = %d, want %d", severity, int(severity), value)
		}
		if !severity.Valid() {
			t.Errorf("severity %s must be valid", severity)
		}
	}
}

func TestSeverityRejectsOutOfRange(t *testing.T) {
	for _, severity := range []Severity{0, -1, 6, 100} {
		if severity.Valid() {
			t.Errorf("severity %d must not be valid", severity)
		}
	}
}

func TestSeverityString(t *testing.T) {
	if got := SeverityMedium.String(); got != "MEDIUM" {
		t.Errorf("SeverityMedium.String() = %q, want %q", got, "MEDIUM")
	}
	if got := Severity(9).String(); got != "Severity(9)" {
		t.Errorf("Severity(9).String() = %q, want %q", got, "Severity(9)")
	}
}
