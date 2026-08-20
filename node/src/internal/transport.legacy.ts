import * as http from 'http'; // NOT 'node:http' — the node: prefix isn't recognized by
import * as https from 'https'; // Node's resolver until v14.18/v16; Node 8 throws
import { URL } from 'url'; // "Cannot find module 'node:http'" if used here.
import { ATTEMPT_TIMEOUT_MS } from '../constants';

export interface TransportResponse {
  statusCode: number;
  body: string;
}

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 20 });

/** Node >=8 transport: core http/https only, manual timeout via req.setTimeout() +
 * req.destroy() — no AbortController (not reliably global until Node 15), uniformly
 * across this branch's whole 8-17 range. Named sendRequest — not sendIncident — to
 * stay distinct from the public IncidentClient.sendIncident method one layer up. */
export function sendRequest(
  urlStr: string,
  payload: string,
  headers: Record<string, string>,
): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const req = transport.request(
      parsed,
      { method: 'POST', headers, agent: isHttps ? httpsAgent : httpAgent },
      (res) => {
        res.setEncoding('utf8'); // decode per-chunk correctly; avoids corrupting
        let body = ''; // multi-byte UTF-8 characters split across chunk boundaries
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      },
    );
    req.setTimeout(ATTEMPT_TIMEOUT_MS, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', (err) => reject(err));
    req.end(payload);
  });
}

/** Destroys the shared keep-alive agents so no sockets are left open after close(). */
export function closeTransport(): void {
  httpsAgent.destroy();
  httpAgent.destroy();
}
