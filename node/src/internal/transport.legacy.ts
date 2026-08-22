import * as http from 'http'; // NOT 'node:http' — the node: prefix isn't recognized by
import * as https from 'https'; // Node's resolver until v14.18/v16; Node 8 throws
import { URL } from 'url'; // "Cannot find module 'node:http'" if used here.
import { ATTEMPT_TIMEOUT_MS } from '../constants';

export interface TransportResponse {
  statusCode: number;
  body: string;
}

export interface Transport {
  sendRequest(urlStr: string, payload: string, headers: Record<string, string>): Promise<TransportResponse>;
  closeTransport(): void;
}

/** Node >=8 transport: core http/https only, manual timeout via req.setTimeout() +
 * req.destroy() — no AbortController (not reliably global until Node 15), uniformly
 * across this branch's whole 8-17 range.
 *
 * Each call creates its own private keep-alive agents rather than sharing module-level
 * singletons — a shared singleton would mean one IncidentClient's close() destroys
 * sockets a completely different, still-active IncidentClient instance is using. */
export function createTransport(): Transport {
  const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 20 });

  return {
    sendRequest(urlStr: string, payload: string, headers: Record<string, string>): Promise<TransportResponse> {
      return new Promise((resolve, reject) => {
        const parsed = new URL(urlStr);
        const isHttps = parsed.protocol === 'https:';
        const transport = isHttps ? https : http;
        const req = transport.request(
          parsed,
          { method: 'POST', headers, agent: isHttps ? httpsAgent : httpAgent },
          (res) => {
            // Runs on a later event-loop tick, outside this Promise executor's own
            // synchronous body — the executor only auto-converts a *synchronous* throw
            // into a rejection; a throw from inside this callback would otherwise
            // escape as a raw uncaught exception instead, so it's caught explicitly.
            try {
              res.setEncoding('utf8'); // decode per-chunk correctly; avoids corrupting
              let body = ''; // multi-byte UTF-8 characters split across chunk boundaries
              res.on('data', (chunk: string) => {
                body += chunk;
              });
              res.on('end', () => {
                resolve({ statusCode: res.statusCode ?? 0, body });
              });
            } catch (err) {
              reject(err);
            }
          },
        );
        req.setTimeout(ATTEMPT_TIMEOUT_MS, () => {
          // Same reasoning as above: a timer callback, not covered by the executor's
          // automatic synchronous-throw handling.
          try {
            req.destroy(new Error('Request timed out'));
          } catch (err) {
            reject(err);
          }
        });
        req.on('error', (err) => reject(err));
        req.end(payload);
      });
    },

    /** Destroys this transport's own keep-alive agents so no sockets are left open
     * after close() — never a different instance's agents, since each createTransport()
     * call gets its own pair. */
    closeTransport(): void {
      httpsAgent.destroy();
      httpAgent.destroy();
    },
  };
}
