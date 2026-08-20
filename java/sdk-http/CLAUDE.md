# `sdk-http` Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file adds rules for the delivery artifact.

## Purpose

`sdk-http` is the user-facing runtime implementation module. It depends on `sdk-core` and owns:

- The final `IncidentClient` façade
- Minimal client configuration
- Apache HttpClient lifecycle and pooling
- JSON wire serialization/parsing
- Synchronous retry
- Bounded asynchronous delivery
- Internal counters and drop logging

The public client requires exactly two credentials: `apiKey` and `serviceKey`.
Tenant is not a separate configuration value and must not be emitted in the
incident JSON payload.

The `sdk-bundle` module packages this module and all runtime dependencies into the distributable `oppex-integration-sdk` library JAR. Keep shading concerns out of `sdk-http`.

## Dependency rules

- Apache HttpClient and Jackson Core are allowed internal dependencies.
- Framework dependencies are forbidden here.
- Apache and Jackson types must not appear in supported public signatures.
- Do not add a second HTTP stack.
- Do not enable Apache automatic retries; `RetryExecutor` owns retry policy.
- Do not introduce a transport SPI or service loader in V1.

## Thread-safety rules

- A client owns exactly one HTTP client, pool, async dispatcher, metrics instance, and retry executor.
- Client defaults and collaborator references remain final.
- Sync delivery and close remain coordinated so resources cannot close mid-sync-call.
- Async submission remains bounded and does not wait for capacity.
- Close remains idempotent.
- Worker threads remain daemon threads.
- Interrupt status must always be restored when interruption is caught.

## Supported versus internal API

Only `IncidentClient` and `IncidentClientBuilder` extend the supported API from this module. Everything below `dev.oppex.sdk.internal` is unsupported, even where cross-package Java visibility requires public declarations.

Do not reference internal classes in README examples or framework modules.

## Test strategy

- Keep retry tests deterministic by injecting a sleeper; never make unit tests wait through real backoff.
- Use a local JDK `HttpServer` for HTTP tests; never call Oppex over the network.
- Make queue tests deterministic with latches.
- Test both success paths and lifecycle/race boundaries.
- Avoid sleeps as concurrency synchronization.

## Verification

```shell
mvn -pl sdk-http -am clean verify
mvn clean verify
```

Confirm representative production classes remain class-file version 51 after compiler changes.
