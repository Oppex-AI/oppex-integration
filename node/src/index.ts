/** Public entry point — everything under internal/ is deliberately not re-exported here. */
export { IncidentClient } from './IncidentClient';
export type { IncidentClientOptions, SendIncidentAsyncCallbacks } from './IncidentClient';
export { Severity } from './model/Severity';
export type { IncidentRequestInput } from './model/IncidentRequest';
export type { IncidentResponse } from './model/IncidentResponse';
export type { IncidentClientLogger } from './model/IncidentClientLogger';
// The one shared, central logger every part of this SDK actually uses — call
// logger.setLogger(...) directly, or pass `logger` in an IncidentClient's options,
// either one sets the same central instance.
export { logger, Logger } from './Logger';
