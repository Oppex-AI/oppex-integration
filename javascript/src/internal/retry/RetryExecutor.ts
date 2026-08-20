import { RETRY_DELAYS_MS } from '../../constants';

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pure retry loop, zero Node API. 3 retries (4 attempts total), fixed delays, no
 * jitter. Not exposed as public config, so every caller gets the same, predictable
 * retry policy. Individual retry attempts are never logged, to avoid flooding the host
 * application's logs — only the final failure, if any, is annotated with an attempt
 * count, and only for a network-level failure, per withAttemptCountIfNetworkFailure
 * below. */
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
 * Appends an attempt count only to a network-level failure (`code: -1`, meaning no
 * real HTTP response was ever received) once retries exhaust — not a blanket "always
 * append attempts" rule. An HTTP-status failure (`code !== -1`), retryable or not,
 * always keeps its original message unchanged, even after exhausting retries: the
 * status code already tells the caller what happened, and an attempt count there
 * would just be noise.
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
