# Model Package Guide

This package is governed by [`../../../../../../../../CLAUDE.md`](../../../../../../../../CLAUDE.md) and [`../../../../../../../CLAUDE.md`](../../../../../../../CLAUDE.md). This file captures model-specific invariants.

## Scope

- `IncidentRequest` is the immutable outbound incident.
- `IncidentResponse` is the immutable synchronous result.
- `Severity` maps Oppex's numeric severity scale.

## `IncidentRequest`

- Construction must remain builder-based.
- Required fields are `title`, `source`, and `severity`.
- Client defaults provide `serviceKey` and `tenant`; request values may override them.
- `priority` defaults to 1 and remains in the range 1 through 5.
- `srcTimestamp` defaults at build time and must be positive.
- `source` must remain no longer than 255 characters, matching the backend storage constraint.
- Optional strings are either absent or non-blank.
- `details` is serialized as the string-valued wire field `detailsJSON`; do not accidentally write it as a nested object.

Do not add setters, mutable field types, lazy mutation, or validation that depends on network state.

## `IncidentResponse`

Keep it a passive value. It must not trigger retries, parse JSON, or own resources. HTTP status classification belongs in `sdk-http`.

## `Severity`

The mapping is fixed:

```text
1 LOWEST
2 LOW
3 MEDIUM
4 HIGH
5 CRITICAL
```

Do not reorder or renumber enum constants. Add mapping tests if the backend contract changes.

## Tests

Model tests belong under `sdk-core/src/test/java/dev/oppex/sdk/model`. Test both valid construction and every rejection boundary. Tests must use Java 7 syntax.

