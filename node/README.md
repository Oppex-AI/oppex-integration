# Oppex Node.js SDK

Node.js SDK for posting incidents to Oppex:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

Published as **`@oppex/integration-sdk`** across two independently versioned major
lines, split at the one real Node capability boundary in the supported range (native
`fetch`, Node 18). Both are built from this one branch — see
[`CLAUDE.md`](./CLAUDE.md) §2 for how:

| Major | Node floor | Transport | Variant |
| --- | --- | --- | --- |
| `^1.0.0` | `>=8` | core `http`/`https` | `legacy` |
| `^2.0.0` | `>=18` | global `fetch` | `modern` |

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
  this exact script, unmodified, for every `{variant, node}` combination — so a local
  run and a CI run exercise identical logic.

- **`scripts/release.sh <legacy-version|-> <modern-version|->`** — cuts a release.
  Runs only on the current branch (in practice, always `master`, the only long-lived
  branch), bumps the version(s), calls `build-variant.sh` internally to verify the bump
  *before* committing, then creates `node-release-X.Y.Z` as a plain branch pointing at
  that commit:

  ```shell
  scripts/release.sh 1.0.1 2.1.0   # release both
  scripts/release.sh 1.0.1 -       # "-" skips a variant
  ```

See [`CLAUDE.md`](./CLAUDE.md) for the engineering rationale behind the two-variant
structure, the release branch lifecycle, and documented behavioral differences from
the Java SDK.
