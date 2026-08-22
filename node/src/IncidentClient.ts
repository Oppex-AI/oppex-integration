import { IncidentRequest, IncidentRequestInput, buildIncidentRequest } from './model/IncidentRequest';
import { IncidentResponse } from './model/IncidentResponse';
import { IncidentClientLogger } from './model/IncidentClientLogger';
import { InvalidRequestError, ClientClosedError } from './model/errors';
import { ENDPOINT_URL, CLOSE_DRAIN_TIMEOUT_MS } from './constants';
import { executeWithRetry } from './internal/retry/RetryExecutor';
import { AsyncDispatcher } from './internal/async/AsyncDispatcher';
import { logger } from './Logger';
import { serializeRequest, parseResponse } from './internal/wire/wireCodec';
import { isRetryableStatus } from './internal/http/retryableStatus';
import { createTransport } from './internal/transport';

export interface IncidentClientOptions {
  apiKey: string;
  // Optional, and null/'' are valid, deliberate values — not errors. Omitted, null,
  // or '' all mean every call from this client auto-routes on the Oppex side unless a
  // specific call overrides it with its own serviceKey.
  serviceKey?: string | null;
  // Defaults to console (error/warn/info/debug) when omitted — pass a Winston/Pino
  // instance directly to route this client's internal logging into a host's existing
  // pipeline; no adapter code needed, since they already implement this same shape.
  logger?: IncidentClientLogger;
}

export interface SendIncidentAsyncCallbacks {
  onSuccess?: (response: IncidentResponse) => void;
  onError?: (error: unknown) => void;
}

interface DeliveryFailure {
  readonly retryable: boolean;
  readonly code: number;
  readonly message: string;
}

function isDeliveryFailure(err: unknown): err is DeliveryFailure {
  return typeof err === 'object' && err !== null && 'retryable' in err && 'code' in err;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function logMessage(err: unknown): string {
  return `[oppex-sdk] ${describeError(err)}`;
}

/** Never throws or rejects, under any circumstance — validation failures, closed-client
 * calls, and unexpected internal errors are all converted to the same shape a delivery
 * failure produces. */
function toFailedResponse(err: unknown): IncidentResponse {
  if (isDeliveryFailure(err)) {
    return { successful: false, code: err.code, message: err.message, incidentId: null };
  }
  return { successful: false, code: -1, message: describeError(err), incidentId: null };
}

/**
 * Client façade for posting incidents to Oppex. Create one client per application,
 * reuse it concurrently, and close it during application shutdown.
 *
 * Neither sendIncident nor sendIncidentAsync ever throws or rejects. This is
 * deliberate: an incident-reporting call is most often made from inside a catch block
 * already handling a different failure, and a reporting call that can itself throw
 * risks turning a handled failure into an unhandled process crash.
 */
export class IncidentClient {
  private readonly apiKey: string;
  private readonly serviceKey: string | null | undefined;
  private readonly dispatcher = new AsyncDispatcher();
  // Each client gets its own transport instance — a shared, module-level pool would
  // mean one client's close() destroys sockets a different, still-active client is
  // using (see node/CLAUDE.md's documented divergences).
  private readonly transport = createTransport();
  private closed = false;

  constructor(options: IncidentClientOptions) {
    // Construction-time validation of client credentials is the one place this SDK
    // still throws synchronously. The "never throws" guarantee is scoped to
    // sendIncident/sendIncidentAsync, not to misusing the constructor itself.
    if (!options || typeof options.apiKey !== 'string' || options.apiKey.trim().length === 0) {
      throw new InvalidRequestError('apiKey is required');
    }
    // serviceKey is optional here, and null/'' are valid values (they mean
    // auto-route), not errors — only a wrong type is rejected.
    if (
      options.serviceKey !== undefined &&
      options.serviceKey !== null &&
      typeof options.serviceKey !== 'string'
    ) {
      throw new InvalidRequestError('serviceKey must be a string, null, or omitted');
    }
    this.apiKey = options.apiKey;
    this.serviceKey = options.serviceKey;
    // Sets the one shared, central logger every part of this SDK actually uses (see
    // ./Logger.ts) — not something resolved per-instance. If omitted, the central
    // logger is left exactly as it already was (its own default is console).
    if (options.logger) {
      logger.setLogger(options.logger);
    }
  }

  /**
   * Waits for the result. Never throws or rejects — resolves with `successful: false`
   * for an invalid request, a call made after close(), a delivery failure after
   * retries exhaust, or any unexpected internal error. The caller never needs a
   * try/catch around `await client.sendIncident(...)`.
   */
  async sendIncident(input: IncidentRequestInput): Promise<IncidentResponse> {
    // Each block below knows exactly what it caught, by construction — no need to
    // catch broadly and then re-derive severity from the error's type afterward.
    if (this.closed) {
      const err = new ClientClosedError();
      logger.warn(logMessage(err));
      return toFailedResponse(err);
    }

    let request: IncidentRequest;
    try {
      request = buildIncidentRequest(input);
    } catch (err) {
      logger.warn(logMessage(err));
      return toFailedResponse(err);
    }

    try {
      const response = await this.deliver(request);
      // "Created" means Oppex actually confirmed it, not just that local validation
      // passed — gated on a real incidentId coming back, not merely successful:true,
      // since a 2xx response without one hasn't actually confirmed an id to report.
      if (response.successful && response.incidentId) {
        logger.info(`[oppex-sdk] Incident created (sync): ${request.title} (incidentId=${response.incidentId})`);
      }
      return response;
    } catch (err) {
      // deliver() only rethrows for a genuinely unanticipated failure — every
      // ordinary delivery failure (network error, non-retryable status, retries
      // exhausted) already resolves as a normal response, never a throw.
      logger.error(logMessage(err));
      return toFailedResponse(err);
    }
  }

  /**
   * Fire-and-forget. Same blanket guarantee as sendIncident — never throws or rejects.
   * Everything is logged internally, since there is no caller awaiting a result;
   * optional onSuccess/onError callbacks are invoked synchronously from inside the same
   * catch-everything path as a pure observation hook and never change this guarantee.
   */
  sendIncidentAsync(input: IncidentRequestInput, callbacks: SendIncidentAsyncCallbacks = {}): void {
    const invokeOnError = (err: unknown) => {
      try {
        callbacks.onError?.(err);
      } catch (callbackErr) {
        // A misbehaving caller-supplied callback must never crash the dispatcher —
        // and we know exactly what this is: the caller's own callback throwing.
        logger.warn(logMessage(callbackErr));
      }
    };

    if (this.closed) {
      const err = new ClientClosedError();
      logger.warn(logMessage(err));
      invokeOnError(err);
      return;
    }

    // Logged here, synchronously, before submit() — input isn't validated yet at
    // this point (that happens inside the task below, which may run immediately or
    // sit queued for a while), so this only confirms the call was accepted and
    // handed to the dispatcher, not that it's a valid request.
    logger.debug(`[oppex-sdk] Incident queued for async delivery: ${input && input.title}`);

    this.dispatcher.submit(async () => {
      // No this.closed check here, deliberately: reaching this point already proves
      // this task was submitted before close() was called (a call made after close()
      // was already rejected above, before ever reaching the dispatcher). By the time
      // the dispatcher actually runs a queued task, this.closed may well be true —
      // close() flips it immediately, then drains — but that's not a reason to reject
      // it now: the transport isn't torn down until AFTER the whole drain finishes
      // (see IncidentClient.close()), so this attempt has a fully live connection
      // pool to use, exactly like any other request.
      let request: IncidentRequest;
      try {
        request = buildIncidentRequest(input);
      } catch (err) {
        logger.warn(logMessage(err));
        invokeOnError(err);
        return;
      }

      try {
        const response = await this.deliver(request);
        if (response.successful) {
          // Same as sendIncident: "created" means Oppex actually confirmed it, gated
          // on a real incidentId, not just that the request passed local validation.
          if (response.incidentId) {
            logger.info(`[oppex-sdk] Incident created (async): ${request.title} (incidentId=${response.incidentId})`);
          }
          try {
            callbacks.onSuccess?.(response);
          } catch (callbackErr) {
            logger.warn(logMessage(callbackErr));
          }
        } else {
          logger.error(logMessage(new Error(response.message ?? 'incident delivery failed')));
          invokeOnError(response);
        }
      } catch (err) {
        // Same as sendIncident: deliver() only rethrows for a genuinely
        // unanticipated failure, never an ordinary delivery outcome.
        logger.error(logMessage(err));
        invokeOnError(err);
      }
    });
  }

  /**
   * Idempotent. Drains the async queue up to a bounded timeout, then closes the
   * transport. Subsequent sendIncident/sendIncidentAsync calls resolve/log a
   * "client closed" outcome rather than attempting delivery.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.dispatcher.close(CLOSE_DRAIN_TIMEOUT_MS);
    this.transport.closeTransport();
  }

  private async deliver(request: IncidentRequest): Promise<IncidentResponse> {
    // request.serviceKey === undefined means "not specified for this call" -> fall
    // back to the client's default. An explicit null or '' is a deliberate override
    // in its own right (auto-route this specific call) and must NOT fall back — `??`
    // would incorrectly treat null the same as undefined here, so this uses an exact
    // `=== undefined` check instead.
    const serviceKey = request.serviceKey === undefined ? this.serviceKey : request.serviceKey;
    const payload = serializeRequest({ ...request, serviceKey });
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-KEY': this.apiKey,
    };

    try {
      return await executeWithRetry(
        async () => {
          let response;
          try {
            response = await this.transport.sendRequest(ENDPOINT_URL, payload, headers);
          } catch (networkErr) {
            const failure: DeliveryFailure = { retryable: true, code: -1, message: describeError(networkErr) };
            throw failure;
          }
          if (isRetryableStatus(response.statusCode)) {
            const failure: DeliveryFailure = {
              retryable: true,
              code: response.statusCode,
              message: `HTTP ${response.statusCode}`,
            };
            throw failure;
          }
          return parseResponse(response.statusCode, response.body);
        },
        (err) => (isDeliveryFailure(err) ? err.retryable : false),
      );
    } catch (err) {
      if (isDeliveryFailure(err)) {
        return { successful: false, code: err.code, message: err.message, incidentId: null };
      }
      throw err;
    }
  }
}
