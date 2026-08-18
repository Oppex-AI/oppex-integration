# `sdk-http` Test Guide

Tests here protect delivery policy, concurrency accounting, JSON wire compatibility, HTTP classification, and client configuration.

## Determinism

- Retry tests inject a recording/no-op sleeper; never wait through production delays.
- Queue tests use `CountDownLatch` and thread-safe collections; do not coordinate with arbitrary sleeps.
- HTTP tests bind a loopback `HttpServer` on an ephemeral port.
- Tests never call the real Oppex endpoint and never use real credentials.

## Coverage expectations

- Every retryable status change needs a positive retry test.
- Every explicitly non-retryable status change needs a no-retry test.
- Queue changes need overflow, shutdown, and metric-accounting coverage.
- Wire changes need exact field-name, escaping, omission, and override-precedence coverage.
- Lifecycle changes need close/idempotency/rejection coverage proportional to the race being changed.

Keep tests in the same package as the internal class when package-private test seams are needed. Do not widen production API solely for tests.

Run `mvn -pl sdk-http -am test` during development and `mvn clean verify` before handoff.
