# Oppex Node.js SDK

Node.js SDK for posting incidents to Oppex:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

Published as **two separate npm packages**, split at the one real Node capability
boundary in the supported range (native `fetch`, Node 18) — not one package with two
major version lines. Both are built from this one branch — see
[`CLAUDE.md`](./CLAUDE.md) §2 for how. For how a call actually flows through the SDK
at runtime, see [`docs/architecture.md`](./docs/architecture.md).

| Package | Node floor | Transport |
| --- | --- | --- |
| [`@oppex/integration-sdk`](https://www.npmjs.com/package/@oppex/integration-sdk) | `>=18` | global `fetch` |
| [`@oppex/integration-sdk-legacy`](https://www.npmjs.com/package/@oppex/integration-sdk-legacy) | `>=8` | core `http`/`https` |

Install whichever one matches your runtime:

```shell
npm install @oppex/integration-sdk           # Node 18+
npm install @oppex/integration-sdk-legacy    # Node 8+
```

Being separate packages rather than major-version lines of one package means there's
no shared `latest` dist-tag to manage between them — each has its own, independent of
the other's release cadence. Works identically with npm, pnpm, and yarn — all three
install from the same npm registry publish.

## Usage

```js
// Node 18+: const { IncidentClient, Severity } = require('@oppex/integration-sdk');
// Node 8+:  const { IncidentClient, Severity } = require('@oppex/integration-sdk-legacy');
const { IncidentClient, Severity } = require('@oppex/integration-sdk');

const client = new IncidentClient({
  apiKey: 'api-key',
  serviceKey: 'service-key', // optional — omit, or pass null/'', to auto-route on Oppex
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
application shutdown. This matters concretely for the `@oppex/integration-sdk-legacy`
(`http`/`https`) package: each client owns its own private, keep-alive `Agent` — a
deliberate choice, so that one client's `close()` can never destroy sockets a
different, still-active client depends on — but it also means an abandoned client that
never calls `close()` leaves its socket open indefinitely, with nothing else able to
reclaim or reuse it. Creating a fresh client per request instead of reusing one
accumulates one such socket per abandoned client for as long as the process keeps
running (bounded by process lifetime, not permanent — the OS reclaims everything the
moment the process itself exits). `@oppex/integration-sdk` (modern, `fetch`-based) does
not have this concern: it has no per-client connection pool to abandon.

### Logging

Internal SDK logging (validation warnings, delivery failures, overload notices)
defaults to `console`. Pass any logger that exposes `error`/`warn`/`info`/`debug` —
Winston, Pino, or a custom wrapper all already match this shape — to route it into
your own logging pipeline instead:

```js
const client = new IncidentClient({
  apiKey: 'api-key',
  serviceKey: 'service-key',
  logger: winstonLogger, // any object with error/warn/info/debug methods works
});
```

This sets one shared, process-wide logger — every `IncidentClient` in your app logs
through it, not just the one you passed it to. You can also set it directly, without
constructing a client first:

```js
const { logger } = require('@oppex/integration-sdk');
logger.setLogger(winstonLogger);
```

Every level is optional — implement only the ones you care about; anything you don't
provide falls back to `console`'s matching method individually. A logger method that
throws is caught internally and never propagates.

Beyond warnings and delivery failures, every incident's own lifecycle is logged too:
`sendIncident`/`sendIncidentAsync` each log at `info` once the request is validated
("Incident created"), and `sendIncidentAsync` additionally logs at `debug` the moment
it's handed to the internal queue ("Incident queued for async delivery") — before it's
necessarily run, since it may sit queued for a while under load. These are per-incident
and can be high-volume; since the default (no `logger` supplied) falls back to plain
`console`, which has no level filtering, they print unconditionally unless you supply a
logger whose own `info`/`debug` methods filter them (e.g. Winston/Pino configured with
`level: 'warn'` or higher, to silence both).

## Build and release

Two scripts, two distinct jobs — deliberately kept separate rather than one script
doing both:

- **`scripts/build-variant.sh <legacy|modern>`** — builds and tests one variant **on
  whatever branch/commit is currently checked out.** No branch switching, no
  assumption about `master`. Stages that variant's `package.json`/
  `package-lock.json`/`tsconfig.json`/`transport.ts`, installs, builds, and runs the
  full test suite:

  ```shell
  scripts/build-variant.sh modern   # or legacy
  ```

  This is the one used in CI: `.github/workflows/node-compatibility.yml`'s matrix runs
  this exact script, unmodified, against every `matrix.node` version (after first
  building under one fixed modern Node — see `CLAUDE.md` §7 for why).

- **`scripts/build-all.sh`** — builds and tests **both** variants in one run, before
  raising a PR (or before publishing). There's no release-branch mechanism and no
  script that bumps a version for you: a version bump is a plain, reviewed edit to
  `variants/<variant>/package.json`, made like any other change in the PR. This
  script's job is to verify both variants still build and pass after whatever changed,
  and to sync each variant's committed `package-lock.json` to match:

  ```shell
  scripts/build-all.sh
  ```

  Releases happen straight from `master` once a version-bump PR merges — no branch to
  cut or check out. See [`CLAUDE.md`](./CLAUDE.md) §8 for the exact publish steps.

See [`CLAUDE.md`](./CLAUDE.md) for the engineering rationale behind the two-variant
structure and documented behavioral differences from the Java SDK.
