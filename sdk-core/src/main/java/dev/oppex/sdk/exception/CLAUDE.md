# Exception Package Guide

This package contains only the supported checked `IncidentException` type. Read the repository and `sdk-core` guides first.

## Contract

- Delivery failures from synchronous `IncidentClient.post()` use this checked exception.
- `statusCode` is the HTTP status or `-1` when no response was received.
- `retryable` describes transport classification; it does not mean the SDK has retries remaining.
- Preserve the cause for I/O, interruption, and parsing diagnostics.
- Keep `serialVersionUID` stable.

Do not add Apache, Jackson, framework, executor, or Java 8+ types to constructors or getters. Avoid a large exception hierarchy unless callers have a demonstrated need that cannot be handled with the existing status and retryable fields.

Changes to constructor behavior or status conventions are supported API changes and require compatibility review.

