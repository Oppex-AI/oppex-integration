# Client API Package Guide

Read the root and `sdk-http` guides before editing this package.

## Scope

This package contains the final, thread-safe `IncidentClient` façade. It is the lifecycle boundary for every resource owned by an SDK client.

## Required behavior

- `builder()` must remain usable on Java 7 because `IncidentClient` is a class, not an interface.
- `post(request)` runs on the caller thread and throws checked `IncidentException` on delivery failure.
- `postAsync(request)` submits fire-and-forget work without waiting for queue capacity.
- `close()` drains async work for a bounded time and releases HTTP resources.
- Repeated close calls are harmless.
- One instance is safe for concurrent application use.

## Lifecycle ordering

Do not reorder shutdown casually. Async work uses the same HTTP client as sync work, so the dispatcher must drain or stop before the HTTP client and connection manager close.

The fair read/write lifecycle lock protects synchronous calls from close. Async submission deliberately avoids that lock so a caller does not block behind the close drain; atomic close state in the façade and dispatcher resolves the race.

## API stability

- Do not turn the class back into an interface while Java 7 and `IncidentClient.builder()` are required.
- Do not expose executors, metrics, Apache clients, retry objects, endpoints, or timeout configuration.
- Prefer the builder in documentation even though the direct three-string constructor exists.
- New methods must remain Java 7-compatible and should be additive.

## Security

Never log the API key, request body, or incident details. Failure logs should contain only bounded diagnostic information.

