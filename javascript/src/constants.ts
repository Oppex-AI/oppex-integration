/** Wire endpoint. Overridable only via an undocumented env var for local-server tests —
 * never exposed as public client configuration (matches java/CLAUDE.md's rule against
 * adding a configurable endpoint to the public API solely to simplify testing).
 */
export const ENDPOINT_URL = process.env.OPPEX_TEST_ENDPOINT_URL || 'https://api.oppex.ai/api/v1/incident/post';

/** Collapses Java's separate 3s-connect + 5s-socket timeouts into one attempt deadline —
 * retry classification doesn't depend on the split, only latency shape does. */
export const ATTEMPT_TIMEOUT_MS = 8000;

/** Fixed, non-public retry backoff — 3 retries (4 attempts total), no jitter. */
export const RETRY_DELAYS_MS = [500, 1000, 2000];

export const QUEUE_CAPACITY = 5000;
export const MAX_CONCURRENCY = 2;
export const DROP_LOG_INTERVAL_MS = 60000;
export const CLOSE_DRAIN_TIMEOUT_MS = 10000;
export const MAX_SOURCE_LENGTH = 255;
