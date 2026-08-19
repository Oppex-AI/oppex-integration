import { Severity, severityFromValue } from './Severity';
import { InvalidRequestError } from './errors';
import { MAX_SOURCE_LENGTH } from '../constants';

export interface IncidentRequestInput {
  title: string;
  source: string;
  severity: Severity | number;
  priority?: number;
  srcTimestamp?: number;
  serviceKey?: string;
  tenant?: string;
  component?: string;
  group?: string;
  type?: string;
  details?: string;
}

export interface IncidentRequest {
  readonly title: string;
  readonly source: string;
  readonly severity: Severity;
  readonly priority: number;
  readonly srcTimestamp: number;
  readonly serviceKey?: string;
  readonly tenant?: string;
  readonly component?: string;
  readonly group?: string;
  readonly type?: string;
  readonly details?: string;
}

function requireNonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidRequestError(`${field} is required and must be non-blank`);
  }
  return value;
}

function optionalNonBlank(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidRequestError(`${field} must be non-blank when supplied`);
  }
  return value;
}

/** Mirrors IncidentRequest.Builder.build() in java/sdk-core exactly. Throws
 * InvalidRequestError for internal callers to catch — buildIncidentRequest itself is not
 * part of the "never throws" public surface; IncidentClient.sendIncident/sendIncidentAsync
 * catch everything this can throw and convert it to a logged, non-throwing outcome. */
export function buildIncidentRequest(input: IncidentRequestInput): IncidentRequest {
  if (input === null || typeof input !== 'object') {
    throw new InvalidRequestError('request must be an object');
  }

  const title = requireNonBlank(input.title, 'title');
  const source = requireNonBlank(input.source, 'source');
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new InvalidRequestError(`source must be at most ${MAX_SOURCE_LENGTH} characters`);
  }

  const severity = severityFromValue(Number(input.severity));

  const priority = input.priority === undefined ? 1 : input.priority;
  if (typeof priority !== 'number' || priority < 1 || priority > 5) {
    throw new InvalidRequestError('priority must be between 1 and 5');
  }

  const srcTimestamp = input.srcTimestamp === undefined ? Date.now() : input.srcTimestamp;
  if (typeof srcTimestamp !== 'number' || srcTimestamp <= 0) {
    throw new InvalidRequestError('srcTimestamp must be greater than zero');
  }

  return {
    title,
    source,
    severity,
    priority,
    srcTimestamp,
    serviceKey: optionalNonBlank(input.serviceKey, 'serviceKey'),
    tenant: optionalNonBlank(input.tenant, 'tenant'),
    component: optionalNonBlank(input.component, 'component'),
    group: optionalNonBlank(input.group, 'group'),
    type: optionalNonBlank(input.type, 'type'),
    details: optionalNonBlank(input.details, 'details'),
  };
}
