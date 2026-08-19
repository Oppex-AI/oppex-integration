import { IncidentRequest, IncidentRequestInput, buildIncidentRequest } from './model/IncidentRequest';
import { IncidentResponse } from './model/IncidentResponse';
import { InvalidRequestError, ClientClosedError } from './model/errors';
import { ENDPOINT_URL, CLOSE_DRAIN_TIMEOUT_MS } from './constants';
import { executeWithRetry } from './internal/retry/RetryExecutor';
import { AsyncDispatcher } from './internal/async/AsyncDispatcher';
import { serializeRequest, parseResponse } from './internal/wire/wireCodec';
import { isRetryableStatus } from './internal/http/retryableStatus';
import { sendRequest, closeTransport } from './internal/transport';

export interface IncidentClientOptions {
  apiKey: string;
  serviceKey: string;
  tenant: string;
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

function logInternal(err: unknown): void {
  console.error(`[oppex-sdk] ${describeError(err)}`);
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
 * reuse it concurrently, and close it during application shutdown — same lifecycle
 * contract as the Java SDK's IncidentClient.
 *
 * Neither sendIncident nor sendIncidentAsync ever throws or rejects. This is
 * deliberate: an incident-reporting call is most often made from inside a catch block
 * already handling a different failure, and a reporting call that can itself throw
 * risks turning a handled failure into an unhandled process crash.
 */
export class IncidentClient {
  private readonly apiKey: string;
  private readonly serviceKey: string;
  private readonly tenant: string;
  private readonly dispatcher = new AsyncDispatcher();
  private closed = false;

  constructor(options: IncidentClientOptions) {
    // Construction-time validation of client credentials is the one place this SDK
    // still throws synchronously — matches Java's IncidentClientBuilder validating
    // apiKey/serviceKey/tenant non-blank at build(). The "never throws" guarantee is
    // scoped to sendIncident/sendIncidentAsync, not to misusing the constructor itself.
    if (!options || typeof options.apiKey !== 'string' || options.apiKey.trim().length === 0) {
      throw new InvalidRequestError('apiKey is required');
    }
    if (typeof options.serviceKey !== 'string' || options.serviceKey.trim().length === 0) {
      throw new InvalidRequestError('serviceKey is required');
    }
    if (typeof options.tenant !== 'string' || options.tenant.trim().length === 0) {
      throw new InvalidRequestError('tenant is required');
    }
    this.apiKey = options.apiKey;
    this.serviceKey = options.serviceKey;
    this.tenant = options.tenant;
  }

  /**
   * Waits for the result. Never throws or rejects — resolves with `successful: false`
   * for an invalid request, a call made after close(), a delivery failure after
   * retries exhaust, or any unexpected internal error. The caller never needs a
   * try/catch around `await client.sendIncident(...)`.
   */
  async sendIncident(input: IncidentRequestInput): Promise<IncidentResponse> {
    try {
      if (this.closed) {
        throw new ClientClosedError();
      }
      const request = buildIncidentRequest(input);
      return await this.deliver(request);
    } catch (err) {
      logInternal(err);
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
        // A misbehaving caller-supplied callback must never crash the dispatcher.
        logInternal(callbackErr);
      }
    };

    if (this.closed) {
      const err = new ClientClosedError();
      logInternal(err);
      invokeOnError(err);
      return;
    }

    this.dispatcher.submit(async () => {
      try {
        if (this.closed) {
          throw new ClientClosedError();
        }
        const request = buildIncidentRequest(input);
        const response = await this.deliver(request);
        if (response.successful) {
          try {
            callbacks.onSuccess?.(response);
          } catch (callbackErr) {
            logInternal(callbackErr);
          }
        } else {
          logInternal(new Error(response.message ?? 'incident delivery failed'));
          invokeOnError(response);
        }
      } catch (err) {
        logInternal(err);
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
    closeTransport();
  }

  private async deliver(request: IncidentRequest): Promise<IncidentResponse> {
    const serviceKey = request.serviceKey ?? this.serviceKey;
    const tenant = request.tenant ?? this.tenant;
    const payload = serializeRequest({ ...request, serviceKey, tenant });
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
            response = await sendRequest(ENDPOINT_URL, payload, headers);
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
