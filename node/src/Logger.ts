import { IncidentClientLogger } from './model/IncidentClientLogger';

type LogFn = (message: string, ...meta: unknown[]) => void;

/** Central, process-wide logging sink for this SDK. Every IncidentClient instance,
 * and everything internal to this SDK (AsyncDispatcher's overload notices, etc.),
 * logs through this one shared object rather than each holding its own separately
 * configured copy.
 *
 * Defaults to console. Call setLogger() once — directly, or by passing `logger` to an
 * IncidentClient's constructor options — to redirect every log line this SDK ever
 * produces into a host's own pipeline: Winston, Pino, or any object shaped like
 * `{ error?, warn?, info?, debug? }` works directly, no adapter needed, since those
 * are the same method names console (and virtually every real logger) already uses. */
export class Logger {
  private impl: IncidentClientLogger = console;

  getLogger(): IncidentClientLogger {
    return this.impl;
  }

  setLogger(logger: IncidentClientLogger): void {
    this.impl = logger;
  }

  error(message: string, ...meta: unknown[]): void {
    this.call(this.impl.error, console.error, message, meta);
  }

  warn(message: string, ...meta: unknown[]): void {
    this.call(this.impl.warn, console.warn, message, meta);
  }

  info(message: string, ...meta: unknown[]): void {
    this.call(this.impl.info, console.info, message, meta);
  }

  debug(message: string, ...meta: unknown[]): void {
    this.call(this.impl.debug, console.debug, message, meta);
  }

  // A level the current logger doesn't implement falls back to console's matching
  // method individually — console is the bare-minimum default per level, not an
  // all-or-nothing swap for a partially-implemented logger. A method that throws when
  // actually called is caught and swallowed: a misbehaving logger must never crash
  // the SDK's own internal logging, same reasoning as guarding a caller's
  // onSuccess/onError callback.
  private call(fn: LogFn | undefined, fallback: LogFn, message: string, meta: unknown[]): void {
    const target = typeof fn === 'function' ? fn : fallback;
    try {
      target(message, ...meta);
    } catch {
      // Swallowed deliberately — see above.
    }
  }
}

/** The one shared instance every part of this SDK actually uses. */
export const logger = new Logger();
