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
| [`@oppex-dev/integration-sdk`](https://www.npmjs.com/package/@oppex-dev/integration-sdk) | `>=18` | global `fetch` |
| [`@oppex-dev/integration-sdk-legacy`](https://www.npmjs.com/package/@oppex-dev/integration-sdk-legacy) | `>=8` | core `http`/`https` |

Install whichever one matches your runtime:

```shell
npm install @oppex-dev/integration-sdk           # Node 18+
npm install @oppex-dev/integration-sdk-legacy    # Node 8+
```

Being separate packages rather than major-version lines of one package means there's
no shared `latest` dist-tag to manage between them — each has its own, independent of
the other's release cadence. Works identically with npm, pnpm, and yarn — all three
install from the same npm registry publish.

## Usage

```js
// Node 18+: const { IncidentClient, Severity } = require('@oppex-dev/integration-sdk');
// Node 8+:  const { IncidentClient, Severity } = require('@oppex-dev/integration-sdk-legacy');
const { IncidentClient, Severity } = require('@oppex-dev/integration-sdk');
```

### Setup — one client per application

```js
const client = new IncidentClient({
  apiKey: 'api-key', // required — throws synchronously if missing/blank
  serviceKey: 'service-key', // optional — omit, or pass null/'', to auto-route on Oppex
});
```

`apiKey` is account-level and required — this is the one call in the SDK that doesn't
follow the "never throws" rule below, since a missing/blank key means the client is
unusable and there's no meaningful response to resolve with instead. `serviceKey` is
the per-service routing key; every call below can also pass its own `serviceKey` to
override this client-level default for just that one incident (see
[Overriding the service key per call](#overriding-the-service-key-per-call)).

Create one client per application, reuse it concurrently, and close it during
application shutdown. This matters concretely for the `@oppex-dev/integration-sdk-legacy`
(`http`/`https`) package: each client owns its own private, keep-alive `Agent` — a
deliberate choice, so that one client's `close()` can never destroy sockets a
different, still-active client depends on — but it also means an abandoned client that
never calls `close()` leaves its socket open indefinitely, with nothing else able to
reclaim or reuse it. Creating a fresh client per request instead of reusing one
accumulates one such socket per abandoned client for as long as the process keeps
running (bounded by process lifetime, not permanent — the OS reclaims everything the
moment the process itself exits). `@oppex-dev/integration-sdk` (modern, `fetch`-based) does
not have this concern: it has no per-client connection pool to abandon.

### Creating an incident — `sendIncident` (waits for the result)

```js
const response = await client.sendIncident({
  title: 'Deploy failed', // required, non-blank
  source: 'ci', // required, non-blank, max 255 characters
  severity: Severity.HIGH, // optional — see Severity below
  priority: 3, // optional, 1-5, defaults to 1
  srcTimestamp: Date.now(), // optional, defaults to Date.now() internally
  serviceKey: 'a-different-service-key', // optional — see service-key override below
  component: 'payments-worker', // optional, free-form
  group: 'checkout', // optional, free-form
  type: 'deploy', // optional, free-form
  details: JSON.stringify({ commit: 'abc123' }), // optional, free-form string
});
```

Never throws or rejects, for any reason — an invalid request, a call made after
`close()`, or a real delivery failure all resolve as a response instead of throwing.
Safe to call from inside a `catch` block without wrapping it in another `try`/`catch`.
The resolved shape is always:

```ts
{
  successful: boolean;
  code: number;           // Oppex's response code on success; -1 for any local/
                           // transport-level failure (validation, network, timeout, ...)
  message: string | null; // human-readable outcome, present on both success and failure
  incidentId: string | null; // set only when Oppex actually confirms creation
}
```

```js
if (!response.successful) {
  console.error(response.message);
}
```

### Creating an incident — `sendIncidentAsync` (fire-and-forget)

```js
client.sendIncidentAsync(
  { title: 'Background job failed', source: 'worker', severity: Severity.MEDIUM },
  {
    onSuccess: (response) => console.log(response.incidentId),
    onError: (err) => console.error(err),
  },
);
```

Same "never throws or rejects" guarantee as `sendIncident` — everything is logged
internally, since there's no caller awaiting a result. `onSuccess`/`onError` are
optional, synchronous observation hooks called from inside the same catch-everything
path; they never change that guarantee (a throwing callback is itself caught and
logged, not re-raised). Use this at a call site that's already fire-and-forget by
convention (e.g. inside a `.catch()` handler) and doesn't want to `await` an incident
report before moving on.

### Severity

```js
const { Severity } = require('@oppex-dev/integration-sdk');
// Severity.LOWEST = 1, LOW = 2, MEDIUM = 3, HIGH = 4, CRITICAL = 5
```

`severity` is **optional and unguarded**, matching the Oppex API itself: the API
doesn't require this field or validate its range server-side (confirmed directly
against the real API), so the SDK doesn't enforce a stricter rule than the API
actually has, either.

```js
// Both of these succeed — no severity, no serviceKey, both left for Oppex to decide:
await client.sendIncident({ title: 'x', source: 'y' });

// A supplied value — enum or a raw number 1-5 — is passed straight through, whatever
// it is; even an out-of-range number like 99 is not rejected by the SDK.
await client.sendIncident({ title: 'x', source: 'y', severity: Severity.HIGH });
```

The same applies to any out-of-range or non-numeric value (`0`, `6`, `'high'`,
`undefined`, `NaN`) — all rejected the same way, never thrown.

### Overriding the service key per call

The client's `serviceKey` (set at construction) is the default for every call made
through it. Any individual `sendIncident`/`sendIncidentAsync` call can override it by
passing its own `serviceKey` in the request — useful when one client is shared across
multiple logical services rather than constructing a separate client per service:

```js
const client = new IncidentClient({ apiKey, serviceKey: 'default-service-key' });

await client.sendIncident({ title: '...', source: '...', severity: Severity.HIGH });
// uses 'default-service-key' (serviceKey omitted from the request)

await client.sendIncident({
  title: '...', source: '...', severity: Severity.HIGH,
  serviceKey: 'other-service-key', // overrides the client's default for this one call
});

await client.sendIncident({
  title: '...', source: '...', severity: Severity.HIGH,
  serviceKey: null, // explicit override: auto-route on Oppex, ignoring the client's default
});
```

The three states are meaningfully different: **omitting** `serviceKey` from the
request means "use the client's" — the value is checked with `=== undefined`, not a
falsy check, so it's distinct from explicitly passing **`null`** or **`''`**, both of
which mean "no service key for this call, auto-route on Oppex" and deliberately
override the client's default rather than falling back to it.

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
const { logger } = require('@oppex-dev/integration-sdk');
logger.setLogger(winstonLogger);
```

Every level is optional — implement only the ones you care about; anything you don't
provide falls back to `console`'s matching method individually. A logger method that
throws is caught internally and never propagates.

Beyond warnings and delivery failures, every incident's own lifecycle is logged too.
`sendIncident`/`sendIncidentAsync` each log at `info` once Oppex actually confirms the
incident with a real id ("Incident created", including that id) — not merely once
local validation passes; a successful response with no id to report logs nothing.
`sendIncidentAsync` additionally logs at `debug` the moment a call is accepted, before
it's necessarily run ("Incident queued for async delivery") — it may sit queued for a
while under load, and this is the raw, not-yet-validated title, since validation
hasn't happened yet at that point. These are per-incident and can be high-volume;
since the default (no `logger` supplied) falls back to plain `console`, which has no
level filtering, they print unconditionally unless you supply a logger whose own
`info`/`debug` methods filter them (e.g. Winston/Pino configured with `level: 'warn'`
or higher, to silence both).

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
