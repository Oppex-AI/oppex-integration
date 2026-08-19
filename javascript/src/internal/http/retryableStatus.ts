const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

/** Mirrors java/CLAUDE.md's retry policy exactly — the precise list, not "any 5xx".
 * Anything outside both sets (e.g. 501, 505) is non-retryable, matching Java's
 * "all other statuses are non-retryable unless the policy is deliberately updated" rule. */
export function isRetryableStatus(statusCode: number): boolean {
  if (RETRYABLE_STATUSES.has(statusCode)) {
    return true;
  }
  if (NON_RETRYABLE_STATUSES.has(statusCode)) {
    return false;
  }
  return false;
}
