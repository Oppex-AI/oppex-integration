/** Public entry point — everything under internal/ is deliberately not re-exported here. */
export { IncidentClient } from './IncidentClient';
export type { IncidentClientOptions, SendIncidentAsyncCallbacks } from './IncidentClient';
export { Severity } from './model/Severity';
export type { IncidentRequestInput } from './model/IncidentRequest';
export type { IncidentResponse } from './model/IncidentResponse';
