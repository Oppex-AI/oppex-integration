# Async Delivery Guide

This folder implements best-effort asynchronous submission. Read the parent internal guide and repository guide first.

## Fixed production configuration

```text
core threads       2
maximum threads    2
keep alive         0 ms
queue              ArrayBlockingQueue
capacity           5000
workers            daemon
overflow           drop oldest, retain newest
shutdown wait      10 seconds
```

Do not use `Executors.newFixedThreadPool()`. Construction must continue to show the bounded queue and custom handler explicitly.

## Class responsibilities

- `AsyncDispatcher`: owns the executor, submission, and shutdown.
- `DaemonThreadFactory`: creates consistently named daemon workers.
- `TrackedTask`: provides exactly-once transition from queued to running or dropped.
- `DropOldestRejectedExecutionHandler`: removes the oldest queued task and offers the newest.
- `RateLimitedDropLogger`: aggregates drop warnings.

## Concurrency invariants

- Increment queued before executor submission.
- Decrement queued exactly once when a task starts or is dropped.
- Use `TrackedTask`'s atomic state to prevent double accounting during shutdown races.
- Queue operations on the submission path must remain non-blocking.
- A full queue must prefer the newest incident.
- Submissions after shutdown must be rejected.
- Tasks returned from `shutdownNow()` must be accounted as dropped.

Do not replace latches in tests with timing sleeps. Tests must prove that the oldest queued item is absent and the newest item executes.

Drop logs are summaries, never one warning per incident.

