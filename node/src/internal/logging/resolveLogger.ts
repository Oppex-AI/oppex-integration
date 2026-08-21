import { IncidentClientLogger } from '../../model/IncidentClientLogger';

export type ResolvedLogger = Required<IncidentClientLogger>;

/** Wraps one host-supplied logger method (or console's matching method, if the host
 * didn't provide this specific level) so every call site can call it directly and
 * unconditionally — never checking whether it exists, never risking an exception from
 * a misbehaving implementation escaping into the SDK's own control flow. A missing or
 * non-function method falls back to console's own matching method individually, not
 * console for every level at once — console is the bare-minimum default per level,
 * not an all-or-nothing swap for a partially-implemented logger. */
function safeLogFn(
  fn: ((message: string, ...meta: unknown[]) => void) | undefined,
  fallback: (message: string, ...meta: unknown[]) => void,
): (message: string, ...meta: unknown[]) => void {
  const target = typeof fn === 'function' ? fn : fallback;
  return (message: string, ...meta: unknown[]) => {
    try {
      target(message, ...meta);
    } catch {
      // A misbehaving host-supplied logger must never crash the SDK's own internal
      // logging — same reasoning as guarding a caller's onSuccess/onError callback.
    }
  };
}

/** Resolved exactly once, at IncidentClient construction time, into a fully-populated
 * object where every level is guaranteed present and safe to call — every other call
 * site in this SDK then calls logger.warn(...)/logger.error(...) directly, with no
 * per-call existence check or try/catch of its own. The defensive work happens once
 * here, not on every log call. */
export function resolveLogger(input: IncidentClientLogger | undefined): ResolvedLogger {
  return {
    error: safeLogFn(input?.error, (m, ...a) => console.error(m, ...a)),
    warn: safeLogFn(input?.warn, (m, ...a) => console.warn(m, ...a)),
    info: safeLogFn(input?.info, (m, ...a) => console.info(m, ...a)),
    debug: safeLogFn(input?.debug, (m, ...a) => console.debug(m, ...a)),
  };
}
