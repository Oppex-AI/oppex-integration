# Oppex Node.js SDK

Node.js SDK for posting incidents to Oppex:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

Published as **`@oppex/integration-sdk`** across two independently versioned major
lines, split at the one real Node capability boundary in the supported range (native
`fetch`, Node 18):

| Major | Node floor | Transport | Branch |
| --- | --- | --- | --- |
| `^1.0.0` | `>=8` | core `http`/`https` | `release/1.x` |
| `^2.0.0` | `>=18` | global `fetch` | `feat/node-sdk` (current) |

Install whichever major matches your runtime:

```shell
npm install @oppex/integration-sdk@^2   # Node 18+
npm install @oppex/integration-sdk@^1   # Node 8+
```

Works identically with npm, pnpm, and yarn — all three install from the same npm
registry publish.

## Usage

```js
const { IncidentClient, Severity } = require('@oppex/integration-sdk');

const client = new IncidentClient({
  apiKey: 'api-key',
  serviceKey: 'service-key',
  tenant: 'tenant',
});

// Waits for the result. Never throws or rejects, for any reason — an invalid
// request, a call after close(), or a delivery failure all resolve as a response
// with `successful: false` instead. Safe to call from inside a catch block.
const response = await client.sendIncident({
  title: 'Deploy failed',
  source: 'ci',
  severity: Severity.HIGH,
});

if (!response.successful) {
  console.error(response.message);
}

// Fire-and-forget. Same guarantee — never throws or rejects. Retries internally,
// logs failures, and never lets a rejection escape unhandled.
client.sendIncidentAsync(
  { title: 'Background job failed', source: 'worker', severity: Severity.MEDIUM },
  { onError: (err) => console.error(err) },
);

// Drains in-flight async work (bounded, 10s) and releases transport resources.
await client.close();
```

Create one client per application, reuse it concurrently, and close it during
application shutdown.

## Build

```shell
npm install
npm run build
node test/smoke.js
```

See [`CLAUDE.md`](./CLAUDE.md) for the engineering rationale behind the two-major
structure and its documented behavioral differences from the Java SDK.
