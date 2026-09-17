package oppex

import "strconv"

// Severity is the Oppex incident severity scale, 1 (lowest) through 5 (highest).
type Severity int

// The supported severities. The numeric values are the wire values.
const (
	SeverityLowest   Severity = 1
	SeverityLow      Severity = 2
	SeverityMedium   Severity = 3
	SeverityHigh     Severity = 4
	SeverityCritical Severity = 5
)

// Valid reports whether s is within the Oppex scale of 1 through 5.
func (s Severity) Valid() bool {
	return s >= SeverityLowest && s <= SeverityCritical
}

// String implements [fmt.Stringer].
func (s Severity) String() string {
	switch s {
	case SeverityLowest:
		return "LOWEST"
	case SeverityLow:
		return "LOW"
	case SeverityMedium:
		return "MEDIUM"
	case SeverityHigh:
		return "HIGH"
	case SeverityCritical:
		return "CRITICAL"
	default:
		return "Severity(" + strconv.Itoa(int(s)) + ")"
	}
}
