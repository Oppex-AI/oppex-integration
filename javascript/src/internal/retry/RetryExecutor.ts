import { RETRY_DELAYS_MS } from '../../constants';

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pure retry loop, zero Node API. 3 retries (4 attempts total), fixed delays, no
 * jitter — matches java/CLAUDE.md's documented jitter-free behavior exactly, just at
 * the user's explicitly lower retry count. Not exposed as public config. */
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
      if (attempt >= delaysMs.length || !isRetryable(err)) {
        throw err;
      }
      await sleep(delaysMs[attempt]);
      attempt++;
    }
  }
}
