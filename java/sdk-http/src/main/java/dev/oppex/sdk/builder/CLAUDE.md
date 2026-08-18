# Client Builder Package Guide

Read the root and `sdk-http` guides before editing this package.

`IncidentClientBuilder` intentionally exposes only:

- `apiKey`
- `serviceKey`
- `tenant`

All are required, non-null, and non-blank at build time.

## Rules

- Keep the builder mutable and the built client immutable/thread-safe.
- Validation failures use `IllegalArgumentException` and name the invalid field.
- Do not trim or transform credentials silently.
- Do not add advanced V1 configuration for endpoint, proxy, TLS, timeouts, pool size, retry count, executor, queue capacity, serializer, or logging.
- Do not retain references to mutable user configuration after `build()`.
- Keep fluent methods source-compatible and Java 7-compatible.

If advanced configuration becomes a real requirement, review defaults, binary compatibility, validation, thread safety, and whether it belongs in a new major API version before adding it.

Builder tests belong in the matching test package and must cover missing, null, blank, and successful minimal configuration.

