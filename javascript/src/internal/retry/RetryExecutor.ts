import { RETRY_DELAYS_MS } from '../../constants';

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pure retry loop, zero Node API. 3 retries (4 attempts total), fixed delays, no
 * jitter — matches java/CLAUDE.md's documented jitter-free behavior exactly, just at
 * the user's explicitly lower retry count. Not exposed as public config. Individual
 * retry attempts are never logged (matches java/CLAUDE.md §10: "not separately for
 * each attempt") — only the final failure, if any, is annotated with an attempt count,
 * and only for a network-level failure, per withAttemptCountIfNetworkFailure below. */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  sleep: Sleep = defaultSleep,
  delaysMs: number[] = RETRY_DELAYS_MS,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (err) {
      if (!isRetryable(err)) {
        throw err;
      }
      if (attempt >= delaysMs.length) {
        throw withAttemptCountIfNetworkFailure(err, attempt + 1);
      }
      await sleep(delaysMs[attempt]);
      attempt++;
    }
  }
}

/**
 * Mirrors java/sdk-http's RetryExecutor exactly, not a blanket "always append
 * attempts" rule: Java's IOException branch appends "...after N attempts" only when a
 * *network-level* failure exhausts retries; its IncidentException branch (an
 * HTTP-status failure, retryable or not) always rethrows the original message
 * unchanged, with no attempt count, even after exhausting retries. This SDK's
 * DeliveryFailure shape uses `code: -1` as the same "no real HTTP response involved"
 * sentinel Java's IncidentException.getStatusCode() documents — so that's the
 * discriminator here too: only a `code: -1` failure gets the count appended.
 */
function withAttemptCountIfNetworkFailure(err: unknown, attempts: number): unknown {
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === -1 &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    const failure = err as { message: string };
    return { ...failure, message: `${failure.message} (after ${attempts} attempts)` };
  }
  return err;
}
