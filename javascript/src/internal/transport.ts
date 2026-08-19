import { ATTEMPT_TIMEOUT_MS } from '../constants';

export interface TransportResponse {
  statusCode: number;
  body: string;
}

/** Node >=18 transport: global fetch only, no http/https code at all. Named
 * sendRequest — not sendIncident — to stay distinct from the public
 * IncidentClient.sendIncident method one layer up, which wraps this primitive with
 * retry, validation, and the wire codec. */
export async function sendRequest(
  urlStr: string,
  payload: string,
  headers: Record<string, string>,
): Promise<TransportResponse> {
  const res = await fetch(urlStr, {
    method: 'POST',
    headers,
    body: payload,
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  });
  const body = await res.text().catch(() => '');
  return { statusCode: res.status, body };
}

/** fetch/undici exposes no public, dependency-free handle to close or cap connection
 * concurrency (Java bounds this via a 20-connection pool) — adding one would require
 * the undici package as an explicit dependency, which conflicts with "fetch only, zero
 * deps". Intentional, disclosed difference — see javascript/CLAUDE.md. Nothing to
 * close here. */
export function closeTransport(): void {
  // no-op
}
