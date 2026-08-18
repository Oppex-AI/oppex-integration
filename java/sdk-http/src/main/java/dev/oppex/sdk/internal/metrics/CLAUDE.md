# Internal Metrics Guide

`InternalMetrics` contains client-local atomic counters used by delivery subsystems.

## Meanings

- `queued`: accepted async work that has not started or been dropped
- `processed`: completed logical deliveries
- `successful`: logical deliveries that returned an `IncidentResponse`
- `failed`: logical deliveries that ended in `IncidentException`
- `retried`: retry delays entered
- `dropped`: async tasks discarded before execution

## Rules

- Metrics are not exposed through the V1 public client.
- Do not use static/global counters; each client owns its own instance.
- Queue accounting must never become negative.
- Count one logical delivery as processed regardless of its number of attempts.
- A task dropped before execution is dropped, not processed or failed.
- Keep this class free of logging, scheduling, HTTP, or queue control.

If metrics are later exposed, create an immutable public snapshot after an API review. Do not expose `AtomicLong` or this internal class.

