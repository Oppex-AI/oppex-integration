import { logger } from '../../Logger';

/** Accumulates drop counts and emits at most one summary log line per interval (60s),
 * only if drops actually occurred — avoids flooding the host application's logs with
 * one line per dropped incident during a sustained overload. */
export class RateLimitedDropLogger {
  private droppedInInterval = 0;
  private intervalStartedAt: number;

  constructor(
    private readonly intervalMs: number,
    private readonly log: (message: string) => void = (m) => logger.warn(`[oppex-sdk] ${m}`),
    private readonly now: () => number = Date.now,
  ) {
    this.intervalStartedAt = now();
  }

  recordDrop(): void {
    this.droppedInInterval++;
    const current = this.now();
    if (current - this.intervalStartedAt >= this.intervalMs) {
      const count = this.droppedInInterval;
      this.droppedInInterval = 0;
      this.intervalStartedAt = current;
      if (count > 0) {
        this.log(`Dropped ${count} incidents in the last minute.`);
      }
    }
  }
}
