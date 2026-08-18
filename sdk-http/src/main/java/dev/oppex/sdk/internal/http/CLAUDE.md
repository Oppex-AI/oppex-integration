# HTTP and JSON Guide

This folder is the only place that may use Apache HttpClient or Jackson Core. Read the parent internal guide and repository guide first.

## `HttpExecutor`

Responsibilities are limited to:

1. Serialize a validated request.
2. Build the POST request and headers.
3. Execute through the shared pooled client.
4. Read and parse the response.
5. Convert HTTP failures to `IncidentException` with retry classification.

It must not sleep, enqueue, persist, expose metrics, or implement a transport abstraction.

## HTTP invariants

- Endpoint remains `/api/v1/incident/post` unless the Oppex API contract changes.
- API key is sent only in `X-API-KEY` and never logged.
- Apache automatic retries remain disabled.
- Every response is closed.
- Close failures must not mask an already determined response or exception.
- Only 429, 500, 502, 503, and 504 are retryable HTTP statuses.
- All other HTTP statuses are non-retryable by default.

## `JsonCodec`

- Use streaming Jackson Core, not Databind.
- Preserve exact wire names, especially `serviceKey`, `srcTimestamp`, and `detailsJSON`.
- `detailsJSON` is a JSON-encoded string value, not an embedded JSON object.
- Request-level service key and tenant override client defaults.
- Omit absent optional fields.
- Parse only response fields needed by `IncidentResponse`.
- Malformed successful response JSON becomes a non-retryable SDK exception.
- Malformed error JSON must not obscure its HTTP status.

HTTP tests use a local loopback `HttpServer`, capture headers/body, and must never use production credentials or the real API.

