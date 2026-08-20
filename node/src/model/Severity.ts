/** Oppex incident severity. Oppex uses a scale from 1 (lowest) to 5 (highest). */
export enum Severity {
  LOWEST = 1,
  LOW = 2,
  MEDIUM = 3,
  HIGH = 4,
  CRITICAL = 5,
}

/** Validates a numeric severity. Throws for callers to catch — this is an internal
 * helper consumed by request validation, not part of the "never throws" public surface. */
export function severityFromValue(value: number): Severity {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
    return value;
  }
  throw new Error('severity is required and must be between 1 and 5');
}
