# Retry Policy Guide

This folder owns the complete SDK retry policy. Apache HttpClient retries remain disabled.

## Policy

There is one initial attempt followed by at most five retries:

```text
500 ms
1 second
2 seconds
4 seconds
8 seconds
```

Retry:

- `IOException` while the thread is not already interrupted
- `IncidentException` only when `isRetryable()` is true

Stop immediately for non-retryable SDK failures, exhausted delays, or interruption.

## Invariants

- Increment the retry metric once per entered delay, not once per attempt.
- Restore the interrupt flag when sleep is interrupted.
- Copy injected delay arrays so callers cannot mutate policy state.
- Keep the default policy instance-local; do not introduce mutable static arrays.
- Preserve generic operation execution without exposing Java 8 functional interfaces.

Tests inject a no-op recording sleeper and assert exact delay order and attempt count. Never use real sleeps in retry tests.

Any policy change must update tests, the root `CLAUDE.md`, and `README.md` if it changes observable latency or behavior.

