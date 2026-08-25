/** Internal-only classification, never thrown across the public boundary and never
 * exported from index.ts. Used purely to shape log messages and failed-response
 * `message` fields — nothing in the public API (`sendIncident`/`sendIncidentAsync`)
 * ever throws or rejects, so there is no `instanceof` check a consumer would need. */

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

export class ClientClosedError extends Error {
  constructor(message = 'IncidentClient is closed') {
    super(message);
    this.name = 'ClientClosedError';
  }
}
