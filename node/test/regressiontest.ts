/*
 * Manual regression/load test — NOT part of the automated build-variant.sh suite, not
 * run in CI. Fires a large number of real incidents through the actual built SDK
 * (dist/), with a Winston logger (timestamps included) wired into the SDK's own
 * logger hook, and each incident's own title stamped with its own timestamp too — so
 * every incident is independently identifiable both in this script's logs and on the
 * receiving Oppex stack's side.
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
 * Optional overrides: INCIDENT_COUNT (default 10000), CONCURRENCY (default 50) — how
 * many sendIncident calls run in parallel at once. sendIncident, not
 * sendIncidentAsync, is used deliberately: sendIncidentAsync's internal queue
 * (capacity 5000) would silently drop most of a 10,000-incident burst fired in a tight
 * loop, which defeats the point of a load test that expects every incident to actually
 * attempt delivery. Concurrency here is this script's own choice, not the SDK's fixed
 * fire-and-forget cap.
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
const incidentCount = Number(process.env.INCIDENT_COUNT) || 10000;
const concurrency = Number(process.env.CONCURRENCY) || 50;

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`),
  ),
  transports: [new winston.transports.Console()],
});

// logger is passed straight to IncidentClient — no adapter code needed, since Winston
// already implements the error/warn/info/debug shape the SDK's logger hook expects.
const client = new IncidentClient({ apiKey, serviceKey, logger });

async function fireOne(index: number): Promise<boolean> {
  const response = await client.sendIncident({
    // Every incident's own title carries its own timestamp — distinct from, and in
    // addition to, the timestamp Winston stamps onto this script's own log lines.
    title: `Regression test incident #${index} @ ${new Date().toISOString()}`,
    source: 'regression-test',
    severity: Severity.LOW,
    details: JSON.stringify({ index, firedAtMs: Date.now() }),
  });
  if (!response.successful) {
    logger.warn(`Incident #${index} failed: code=${response.code} message=${response.message}`);
  }
  return response.successful;
}

async function main(): Promise<void> {
  logger.info(`Firing ${incidentCount} incidents at concurrency ${concurrency}...`);
  let succeeded = 0;
  let failed = 0;

  for (let start = 0; start < incidentCount; start += concurrency) {
    const end = Math.min(start + concurrency, incidentCount);
    const batch: Promise<boolean>[] = [];
    for (let i = start; i < end; i++) {
      batch.push(fireOne(i));
    }
    const results = await Promise.all(batch);
    for (const ok of results) {
      if (ok) {
        succeeded++;
      } else {
        failed++;
      }
    }
    logger.info(`Progress: ${end}/${incidentCount} (succeeded=${succeeded}, failed=${failed})`);
  }

  logger.info(`Done. succeeded=${succeeded} failed=${failed}`);
  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error(`Regression test itself threw: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
