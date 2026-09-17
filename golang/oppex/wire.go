package oppex

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// serializeRequest renders the wire payload. A blank resolved service key is
// omitted entirely so the API routes the incident by its own rules, and every
// other absent optional field is omitted rather than sent as null.
//
// json.Encoder is used in place of json.Marshal so the payload keeps a stable,
// declared field order instead of Go's map iteration order.
func serializeRequest(request IncidentRequest, resolvedServiceKey string) ([]byte, error) {
	payload := wireRequest{
		ServiceKey:   resolvedServiceKey,
		Title:        request.Title,
		Source:       request.Source,
		Severity:     int(request.Severity),
		Priority:     request.Priority,
		SrcTimestamp: request.SrcTimestamp,
		Component:    request.Component,
		Group:        request.Group,
		Type:         request.Type,
		DetailsJSON:  request.Details,
	}

	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(payload); err != nil {
		return nil, fmt.Errorf("oppex: encoding the incident payload: %w", err)
	}
	return buffer.Bytes(), nil
}

// wireRequest is the exact payload shape the Oppex API accepts. Field order here
// is the wire order, and omitempty implements the "absent rather than null" rule.
type wireRequest struct {
	ServiceKey   string `json:"serviceKey,omitempty"`
	Title        string `json:"title"`
	Source       string `json:"source"`
	Severity     int    `json:"severity"`
	Priority     int    `json:"priority"`
	SrcTimestamp int64  `json:"srcTimestamp"`
	Component    string `json:"component,omitempty"`
	Group        string `json:"group,omitempty"`
	Type         string `json:"type,omitempty"`
	DetailsJSON  string `json:"detailsJSON,omitempty"`
}

// wireResponse mirrors the API envelope. Every field is optional, so each one
// falls back to what the HTTP status already told us.
type wireResponse struct {
	Success *bool   `json:"success"`
	Code    *int    `json:"code"`
	Message *string `json:"message"`
	Data    *string `json:"data"`
}

// parseResponse decodes a response body, falling back to the HTTP status for any
// field the body does not carry.
//
// A body that is not JSON is never echoed back into the returned message: a proxy
// or WAF can return an error page that repeats request headers, including
// X-API-KEY, and that text would then leak into the host application's logs.
func parseResponse(statusCode int, body []byte) (IncidentResponse, error) {
	response := IncidentResponse{
		Successful: statusCode >= 200 && statusCode < 300,
		Code:       statusCode,
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return response, nil
	}

	var decoded wireResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return IncidentResponse{}, &IncidentError{
			Message:    fmt.Sprintf("Oppex returned a non-JSON response (status %d)", statusCode),
			StatusCode: statusCode,
			Err:        err,
		}
	}

	if decoded.Success != nil {
		response.Successful = *decoded.Success
	}
	if decoded.Code != nil {
		response.Code = *decoded.Code
	}
	if decoded.Message != nil {
		response.Message = *decoded.Message
	}
	if decoded.Data != nil {
		response.IncidentID = *decoded.Data
	}
	return response, nil
}
