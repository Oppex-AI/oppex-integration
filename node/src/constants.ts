/** Wire endpoint. Overridable only via an undocumented env var for local-server tests —
 * never exposed as public client configuration, to keep the public surface minimal and
 * avoid adding a knob that exists solely to simplify testing.
 */
export const ENDPOINT_URL = process.env.OPPEX_TEST_ENDPOINT_URL || 'https://api.oppex.ai/api/v1/incident/post';

/** Single deadline covering an entire attempt (connection plus response), rather than
 * separate connect/read phases — retry classification only needs to know whether an
 * attempt failed, not which phase it failed in. */
export const ATTEMPT_TIMEOUT_MS = 8000;

/** Fixed, non-public retry backoff — 3 retries (4 attempts total), no jitter. */
export const RETRY_DELAYS_MS = [500, 1000, 2000];

export const QUEUE_CAPACITY = 5000;
export const MAX_CONCURRENCY = 2;
export const DROP_LOG_INTERVAL_MS = 60000;

/** How long close() waits for in-flight/queued incidents to drain before force-dropping
 * whatever remains. 10s is a deliberate, bounded-loss tradeoff, not a rounder-is-better
 * guess — it fits inside Docker's default 10s stop grace period and leaves headroom
 * under Kubernetes' default 30s terminationGracePeriodSeconds. Raising it to try to
 * cover a worst-case retry chain is counterproductive: the orchestrator SIGKILLs the
 * process at its own grace-period boundary regardless, so a longer drain timeout here
 * just means more of that same window spent waiting instead of draining, not a higher
 * chance of finishing. If nothing ever calls close(), this constant is irrelevant —
 * an abrupt process exit drops whatever is in flight immediately, the same trade every
 * unflushed in-memory client (e.g. a DB connection pool) makes by default. */
export const CLOSE_DRAIN_TIMEOUT_MS = 10000;

export const MAX_SOURCE_LENGTH = 255;
