import { ATTEMPT_TIMEOUT_MS } from '../constants';

export interface TransportResponse {
  statusCode: number;
  body: string;
}

export interface Transport {
  sendRequest(urlStr: string, payload: string, headers: Record<string, string>): Promise<TransportResponse>;
  closeTransport(): void;
}

/** Node >=18 transport: global fetch only, no http/https code at all.
 *
 * Matches the legacy variant's per-instance createTransport() shape for consistency,
 * even though fetch/undici has no per-instance state to isolate here — there's no
 * public, dependency-free way to create a separate connection pool per call without
 * adding undici as an explicit dependency, which conflicts with "fetch only, zero
 * deps" (see node/CLAUDE.md's documented divergence on this). */
export function createTransport(): Transport {
  return {
    async sendRequest(urlStr: string, payload: string, headers: Record<string, string>): Promise<TransportResponse> {
      const res = await fetch(urlStr, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      const body = await res.text().catch(() => '');
      return { statusCode: res.status, body };
    },

    closeTransport(): void {
      // no-op — see comment above.
    },
  };
}
