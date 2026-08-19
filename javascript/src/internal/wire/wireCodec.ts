import { IncidentRequest } from '../../model/IncidentRequest';
import { IncidentResponse } from '../../model/IncidentResponse';

const MAX_MESSAGE_LENGTH = 500;

/** Exact wire field order per java/CLAUDE.md: serviceKey, title, source, severity,
 * priority, srcTimestamp, tenant, then optional component, group, type, detailsJSON —
 * each optional key omitted entirely (not sent as null) when unset. Relies on
 * plain-object key insertion order, which JSON.stringify preserves for string keys. */
export function serializeRequest(request: IncidentRequest): string {
  const ordered: Record<string, unknown> = {};

  if (request.serviceKey !== undefined) ordered.serviceKey = request.serviceKey;
  ordered.title = request.title;
  ordered.source = request.source;
  ordered.severity = request.severity;
  ordered.priority = request.priority;
  ordered.srcTimestamp = request.srcTimestamp;
  if (request.tenant !== undefined) ordered.tenant = request.tenant;

  if (request.component !== undefined) ordered.component = request.component;
  if (request.group !== undefined) ordered.group = request.group;
  if (request.type !== undefined) ordered.type = request.type;
  if (request.details !== undefined) ordered.detailsJSON = request.details;

  return JSON.stringify(ordered);
}

/** Mirrors JsonCodec.parseResponse: defaults for an empty body, reads success/code/
 * message/data. Defensive: a non-JSON body (e.g. an HTML error page from a proxy) must
 * never throw out of this function — falls back to a truncated-raw-text message. */
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
    const truncated = body.length > MAX_MESSAGE_LENGTH ? `${body.slice(0, MAX_MESSAGE_LENGTH)}…` : body;
    return { successful: successfulDefault, code: httpStatus, message: truncated, incidentId: null };
  }
}
