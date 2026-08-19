import { QUEUE_CAPACITY, MAX_CONCURRENCY, DROP_LOG_INTERVAL_MS } from '../../constants';
import { RateLimitedDropLogger } from './RateLimitedDropLogger';

export type Task = () => Promise<void>;

/** Node equivalent of Java's AsyncDispatcher. Java bounds concurrency via 2 worker
 * threads pulling from a 5000-capacity ArrayBlockingQueue with a drop-oldest rejection
 * handler; Node has no worker threads, so the property actually being ported is "at
 * most 2 fire-and-forget deliveries in flight at once" — implemented here as a plain
 * concurrency counter plus an in-memory queue, not a real thread pool. */
export class AsyncDispatcher {
  private active = 0;
  private closed = false;
  private readonly queue: Task[] = [];
  private idleWaiters: Array<() => void> = [];
  private readonly dropLogger: RateLimitedDropLogger;

  constructor(
    private readonly maxConcurrency: number = MAX_CONCURRENCY,
    private readonly capacity: number = QUEUE_CAPACITY,
    dropLogger?: RateLimitedDropLogger,
  ) {
    this.dropLogger = dropLogger ?? new RateLimitedDropLogger(DROP_LOG_INTERVAL_MS);
  }

  /** Task must already catch its own errors — see IncidentClient.sendIncidentAsync,
   * which wraps every task in its own top-level try/catch before calling submit(). This
   * is enforced by the caller, not re-validated here. */
  submit(task: Task): void {
    if (this.closed) {
      return;
    }
    if (this.active < this.maxConcurrency) {
      this.run(task);
      return;
    }
    if (this.queue.length >= this.capacity) {
      this.queue.shift();
      this.dropLogger.recordDrop();
    }
    this.queue.push(task);
  }

  private run(task: Task): void {
    this.active++;
    task()
      .catch(() => {
        // Last-resort guard only — real errors are handled by the caller's own
        // try/catch before submit(). A bug here must never produce an unhandled
        // rejection regardless.
      })
      .then(() => {
        this.active--;
        const next = this.queue.shift();
        if (next) {
          this.run(next);
        } else if (this.active === 0 && this.queue.length === 0) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          waiters.forEach((resolve) => resolve());
        }
      });
  }

  private waitUntilIdle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Idempotent. Stops accepting new submissions, lets the concurrency pump keep
   * draining the existing queue until idle or the timeout elapses, then force-drops
   * whatever remains — logged as one distinct one-off line, separate from the
   * rate-limited overflow-drop counter (these are semantically different events). */
  async close(timeoutMs: number): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      this.waitUntilIdle().then(finish);
      setTimeout(finish, timeoutMs);
    });
    if (this.queue.length > 0) {
      const forcedDropCount = this.queue.length;
      this.queue.length = 0;
      console.warn(`[oppex-sdk] Force-dropped ${forcedDropCount} pending incidents during close.`);
    }
  }
}
