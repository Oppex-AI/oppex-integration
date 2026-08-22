import { IncidentRequest } from '../../model/IncidentRequest';
import { IncidentResponse } from '../../model/IncidentResponse';

/** Fixed wire field order: serviceKey, title, source, severity, priority, srcTimestamp,
 * then optional component, group, type, detailsJSON. Relies on plain-object key
 * insertion order, which JSON.stringify preserves for string keys.
 *
 * serviceKey is assigned unconditionally, not gated on `!== undefined` the way the
 * other optional fields below are — null and '' are both meaningful, deliberate wire
 * values (Oppex reads either as "auto-route this incident"), not absence. Only a
 * truly undefined serviceKey (never set on the client or overridden per-call) gets
 * dropped from the JSON, which happens automatically: JSON.stringify omits any object
 * property whose value is undefined, but still serializes null and '' literally. */
export function serializeRequest(request: IncidentRequest): string {
  const ordered: Record<string, unknown> = {};

  ordered.serviceKey = request.serviceKey;
  ordered.title = request.title;
  ordered.source = request.source;
  ordered.severity = request.severity;
  ordered.priority = request.priority;
  ordered.srcTimestamp = request.srcTimestamp;

  if (request.component !== undefined) ordered.component = request.component;
  if (request.group !== undefined) ordered.group = request.group;
  if (request.type !== undefined) ordered.type = request.type;
  if (request.details !== undefined) ordered.detailsJSON = request.details;

  return JSON.stringify(ordered);
}

/** Parses a response body into an IncidentResponse: defaults for an empty body, reads
 * success/code/message/data. Defensive: a non-JSON body (e.g. an HTML error page from
 * a proxy) must never throw out of this function — falls back to a generic message
 * instead of the raw body text.
 *
 * Deliberately never includes any of the raw body in that fallback message, even
 * truncated: a misbehaving proxy or WAF can return a non-JSON error/debug page that
 * echoes request headers, including X-API-KEY — echoing any of that raw text back into
 * a log line or response.message would leak it into the host application's own logs. */
export function parseResponse(httpStatus: number, body: string): IncidentResponse {
  const successfulDefault = httpStatus >= 200 && httpStatus < 300;

  if (!body || body.trim().length === 0) {
    return { successful: successfulDefault, code: httpStatus, message: null, incidentId: null };
  }

  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('response body is not a JSON object');
    }
    const obj = parsed as Record<string, unknown>;
    return {
      successful: typeof obj.success === 'boolean' ? obj.success : successfulDefault,
      code: typeof obj.code === 'number' ? obj.code : httpStatus,
      message: typeof obj.message === 'string' ? obj.message : null,
      incidentId: typeof obj.data === 'string' ? obj.data : null,
    };
  } catch {
    return {
      successful: successfulDefault,
      code: httpStatus,
      message: `Received a non-JSON response (status ${httpStatus})`,
      incidentId: null,
    };
  }
}
