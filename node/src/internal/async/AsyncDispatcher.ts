import { QUEUE_CAPACITY, MAX_CONCURRENCY, DROP_LOG_INTERVAL_MS } from '../../constants';
import { RateLimitedDropLogger } from './RateLimitedDropLogger';

export type Task = () => Promise<void>;

/** Bounds fire-and-forget delivery to at most `maxConcurrency` requests in flight at
 * once, queuing the rest up to `capacity` and dropping the oldest queued task once
 * full. Implemented as a plain concurrency counter plus an in-memory queue — there's
 * no thread pool in Node, just a cap on how many deliveries run concurrently.
 *
 * The queue tracks a head index instead of calling Array.prototype.shift() — shift()
 * is O(n) per call (every remaining element has to be re-indexed), which would add
 * needless CPU cost on every dequeue and every drop-oldest eviction, right during the
 * sustained-overload scenario the bounded queue exists to survive. Dequeuing here is
 * O(1); the backing array is only compacted (an O(remaining) slice) once the dead
 * prefix at the front grows past `capacity`, which happens at most once per `capacity`
 * dequeues — so the amortized cost per dequeue stays O(1). */
export class AsyncDispatcher {
  private active = 0;
  private closed = false;
  private queue: Array<Task | undefined> = [];
  private queueHead = 0;
  private idleWaiters: Array<() => void> = [];
  private readonly dropLogger: RateLimitedDropLogger;

  constructor(
    private readonly maxConcurrency: number = MAX_CONCURRENCY,
    private readonly capacity: number = QUEUE_CAPACITY,
    dropLogger?: RateLimitedDropLogger,
  ) {
    this.dropLogger = dropLogger ?? new RateLimitedDropLogger(DROP_LOG_INTERVAL_MS);
  }

  private get queueLength(): number {
    return this.queue.length - this.queueHead;
  }

  private dequeue(): Task | undefined {
    if (this.queueHead >= this.queue.length) {
      return undefined;
    }
    const task = this.queue[this.queueHead];
    this.queue[this.queueHead] = undefined; // release the reference for GC
    this.queueHead++;
    if (this.queueHead >= this.queue.length) {
      // Fully drained — reset rather than carry dead space forward indefinitely.
      this.queue = [];
      this.queueHead = 0;
    } else if (this.queueHead > this.capacity) {
      // Dead prefix has grown past capacity — compact once. This is O(remaining), but
      // amortized over up to `capacity` dequeues it stays O(1) per dequeue.
      this.queue = this.queue.slice(this.queueHead);
      this.queueHead = 0;
    }
    return task;
  }

  private dropOldest(): void {
    this.queue[this.queueHead] = undefined;
    this.queueHead++;
    this.dropLogger.recordDrop();
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
    if (this.queueLength >= this.capacity) {
      this.dropOldest();
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
        const next = this.dequeue();
        if (next) {
          this.run(next);
        } else if (this.active === 0 && this.queueLength === 0) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          waiters.forEach((resolve) => resolve());
        }
      });
  }

  private waitUntilIdle(): Promise<void> {
    if (this.active === 0 && this.queueLength === 0) {
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
    if (this.queueLength > 0) {
      const forcedDropCount = this.queueLength;
      this.queue = [];
      this.queueHead = 0;
      console.warn(`[oppex-sdk] Force-dropped ${forcedDropCount} pending incidents during close.`);
    }
  }
}
