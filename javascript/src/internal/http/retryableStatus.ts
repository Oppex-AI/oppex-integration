const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

/** A precise, explicit list of retryable and non-retryable statuses — not "any 5xx".
 * Anything outside both sets (e.g. 501, 505) is treated as non-retryable by default;
 * widening either set is a deliberate policy change, not an incidental one. */
export function isRetryableStatus(statusCode: number): boolean {
  if (RETRYABLE_STATUSES.has(statusCode)) {
    return true;
  }
  if (NON_RETRYABLE_STATUSES.has(statusCode)) {
    return false;
  }
  return false;
}
