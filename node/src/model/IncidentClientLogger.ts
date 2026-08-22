/** A generic, leveled logger hook — matches the shape virtually every Node logging
 * library already exposes (console, Winston, Pino, and Bunyan all use these exact
 * four lowercase method names). Every method is optional: a host can wire up only the
 * levels they care about, and pass an existing Winston/Pino instance directly with no
 * adapter code, since it already satisfies this shape. */
export interface IncidentClientLogger {
  error?: (message: string, ...meta: unknown[]) => void;
  warn?: (message: string, ...meta: unknown[]) => void;
  info?: (message: string, ...meta: unknown[]) => void;
  debug?: (message: string, ...meta: unknown[]) => void;
}
