/*
 * Manual regression/load test — NOT part of the automated build-variant.sh suite, not
 * run in CI. Fires a large number of real incidents through the actual built SDK
 * (dist/) via sendIncidentAsync — the real fire-and-forget path, exactly how a host
 * application actually uses it, including the SDK's own bounded queue (capacity
 * 5000, 2 concurrent deliveries) and its drop-oldest behavior under a burst this
 * large. A Winston logger is wired straight into the SDK's own logger hook, so the
 * SDK's own internal log lines (delivery failures, drop notices) print with
 * timestamps — this script deliberately logs very little of its own, so those SDK
 * log lines are what you actually see, not script noise.
 *
 * Requires OPPEX_API_KEY / OPPEX_SERVICE_KEY in the environment.
 *
 * Point delivery at a local Oppex stack instead of production via the SDK's own
 * existing test-only seam (src/constants.ts), not anything specific to this script:
 *   OPPEX_TEST_ENDPOINT_URL=http://localhost:4000/api/v1/incident/post
 *
 * Usage (after `npm run build` / build-variant.sh has produced dist/):
 *   OPPEX_API_KEY=... OPPEX_SERVICE_KEY=... \
 *   OPPEX_TEST_ENDPOINT_URL=http://localhost:4000/api/v1/incident/post \
 *   npm run regression
 *
 * Optional override: INCIDENT_COUNT (default 10 — pass INCIDENT_COUNT=10000 or
 * whatever scale you actually want for a real load-test run).
 *
 * Also logs process.memoryUsage() (rss/heapUsed/heapTotal) every 2s at debug level,
 * plus once at the very start and once right after close() — a plain visual gauge
 * while a run is in flight, not a leak check by itself; that needs comparing numbers
 * across repeated runs or increasing INCIDENT_COUNT values, not reading one run alone.
 *
 * The final summary line always reports succeeded/failed/dropped, computed as
 * incidentCount - succeeded - failed. "Dropped" means the SDK's queue overflowed
 * (capacity 5000) and evicted them before they ever attempted delivery — the SDK's
 * own drop-notice log for this is rate-limited to once per 60s, so a short run can
 * finish and exit before that log line ever gets the chance to fire on its own.
 */

import winston from 'winston';
import { IncidentClient, Severity } from '../dist';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // eslint-disable-next-line no-console
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value as string;
}

const apiKey = requireEnv('OPPEX_API_KEY');
const serviceKey = requireEnv('OPPEX_SERVICE_KEY');
const incidentCount = Number(process.env.INCIDENT_COUNT) || 10;

const winstonLogger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`),
  ),
  transports: [new winston.transports.Console()],
});

// winstonLogger is passed straight to IncidentClient — no adapter code needed, since
// Winston already implements the error/warn/info/debug shape the SDK's logger hook
// expects. Every internal SDK log line (delivery failures, AsyncDispatcher's drop
// notices) now prints through this, timestamped, not through raw console.
const client = new IncidentClient({ apiKey, serviceKey, logger: winstonLogger });

let succeeded = 0;
let failed = 0;

function logMemory(): void {
  const mem = process.memoryUsage();
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  winstonLogger.debug(`memory: rss=${mb(mem.rss)}MB heapUsed=${mb(mem.heapUsed)}MB heapTotal=${mb(mem.heapTotal)}MB`);
}

// A plain visual gauge while the run is in flight — not a leak check by itself (a
// single run's numbers don't prove anything; watching them stay flat across repeated
// runs, or grow across increasing INCIDENT_COUNT values, would).
const memoryIntervalHandle = setInterval(logMemory, 2000);

winstonLogger.info(`Firing ${incidentCount} incidents via sendIncidentAsync...`);
logMemory();

for (let i = 0; i < incidentCount; i++) {
  client.sendIncidentAsync(
    {
      // Both the incident number and its own fire timestamp — distinct from, and in
      // addition to, the timestamp Winston stamps onto this script's own log lines.
      title: `Regression test incident #${i} @ ${new Date().toISOString()}`,
      source: 'regression-test',
      severity: Severity.LOW,
      details: JSON.stringify({ index: i, firedAtMs: Date.now() }),
    },
    {
      onSuccess: () => {
        succeeded++;
      },
      onError: () => {
        // No console output here on purpose — the SDK already logs every delivery
        // failure internally (via winstonLogger, wired in above); this callback only
        // needs to keep count for the final summary line below.
        failed++;
      },
    },
  );
}

async function main(): Promise<void> {
  await client.close();
  clearInterval(memoryIntervalHandle);
  logMemory();
  // succeeded + failed won't add up to incidentCount if the queue overflowed
  // (capacity 5000) — those never ran at all, dropped before ever attempting
  // delivery. The SDK's own drop-notice log is rate-limited to once per 60s, so a
  // short run like this one can finish and exit before that log line ever fires —
  // this line is what actually tells you a queue overflow happened either way.
  const dropped = incidentCount - succeeded - failed;
  winstonLogger.info(
    `Done. succeeded=${succeeded} failed=${failed} dropped=${dropped} (of ${incidentCount} submitted)`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  clearInterval(memoryIntervalHandle);
  winstonLogger.error(`Regression test itself threw: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
