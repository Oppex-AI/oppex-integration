# Oppex Node.js SDK Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file records why the
Node.js SDK is structured as it is, which decisions are intentional, and how future
contributors and coding agents must evolve it without accidentally breaking Node
compatibility, the "never throws" delivery contract, or cross-language semantic parity
with the Java SDK.

## 1. Mission

The SDK gives Node.js applications a minimal API for posting incidents to:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

```js
const client = new IncidentClient({ apiKey, serviceKey, tenant });
```

Create one client per application, reuse it concurrently, and close it during
application shutdown — same lifecycle contract as the Java SDK.

## 2. Two majors, not one, not three

Real Node deployments in this SDK's support range span Node 8 through 26. Node 18 is
the one capability boundary in that whole range with comparable significance to
anything else (native `fetch`/`AbortController`/Web Streams) — there is no second
boundary worth a third major. This SDK therefore ships as:

- **`@oppex/integration-sdk@^1`** — branch `release/1.x`, `engines.node >=8`. Transport:
  core `http`/`https`, manual timeout (`req.setTimeout()` + `req.destroy()`). No
  `AbortController` even for the Node 15–17 portion of this branch's range — one
  uniform mechanism across the whole 8–17 span avoids an unnecessary internal branch.
- **`@oppex/integration-sdk@^2`** — branch `feat/node-sdk` (this repo's trunk-equivalent
  for the SDK; there is no branch literally named `main` in this repository), `engines.
  node >=18`. Transport: global `fetch` only, no `http`/`https` code at all.

Both majors are authored from the same modern-TypeScript source (`import`/`export`,
`async`/`await`, generics erased at compile time). Exactly 4 files are allowed to differ
between the two branches — `src/internal/transport.ts`, `tsconfig.json`,
`package.json`, and `package-lock.json` (the `@types/node` pin lives in the latter two).
Everything else, **including this file**, must stay byte-identical — see §8 for the
script that enforces it.

**Maintenance policy**: `release/1.x` receives security/critical patches only.
`feat/node-sdk` is where active feature development happens. This is standard practice
(same as Stripe/Twilio/AWS SDK version-floor raises), not a permanent commitment to
maintaining two diverging feature sets — a genuinely new capability boundary (a future
Node LTS introducing something comparable to `fetch`) would justify a third major later,
following the same reasoning, not a speculative one added now.

## 3. Why flat, not core/http/bundle like Java

Java's `sdk-core`/`sdk-http`/`sdk-bundle` split exists to solve two Java-specific
problems this SDK doesn't have: avoiding a circular dependency between the public
façade and its only implementation, and shading third-party runtime dependencies
(Apache HttpClient, Jackson) into one fat jar so consumers don't resolve transitive
Maven coordinates or risk classpath collisions. This SDK has **zero runtime
dependencies** in both majors — nothing to shade, no transitive graph to hide, no
classpath collision risk. npm's own module resolution already gives consumers one
importable unit. A model-only sub-package would be pure ceremony with no consumer
benefit.

## 4. The Node-8 guardrail: `lib` + `@types/node`, not just `target`

`target` only downlevels *syntax* — it does nothing about *runtime* API availability.
Modern-looking TypeScript that calls `fetch()`, `AbortController`, `Array.prototype.at`,
or `Object.fromEntries` will compile cleanly and crash at runtime on Node 8 unless
something catches it at compile time. `release/1.x`'s `tsconfig.json` uses `target:
"ES2017"` (Node 8's real syntax ceiling — not ES2022, whose private-fields/static-block
syntax isn't all safely downlevelable) and `lib: ["ES2017"]` with no `"DOM"`, so those
globals have **no ambient type declarations** in that branch's type-checking — calling
one is a compile error, not a silent Node-8 crash. This is the direct equivalent of
Java's `animal-sniffer` check (`java/CLAUDE.md` §12) — never remove it to make a change
compile; a build succeeding on a newer Node dev machine proves nothing about actual
Node 8 runtime compatibility.

The pinned `@types/node` version on `release/1.x` matters precisely: `@types/node@8.10.66`
and `@types/node@10.17.60` (the last published patches of those lines) **fail to
compile at all** under a current TypeScript compiler — DefinitelyTyped never backported
a later `Uint8Array`-generics compatibility fix to those frozen lines, so `Buffer`'s
declaration conflicts with `lib.es2017.d.ts`'s `Uint8Array` regardless of anything this
SDK does. `@types/node@14.18.63` compiles fine but already declares a global
`AbortController` (a real Node 15+ API) — DefinitelyTyped had folded that global into
every still-maintained major's latest patch by the time it shipped, so it doesn't
enforce the Node 8–14 boundary despite compiling. **`@types/node@12.20.55`** (pinned to
its own last published patch) is the version that actually enforces the boundary: it
compiles cleanly under TypeScript 5.5, and correctly fails to compile a `fetch(...)` or
`new AbortController()` call anywhere under `src/internal/transport.ts` with `Cannot
find name` — the guardrail blocks both, not just one.

`feat/node-sdk` uses `target: "ES2022"`, `lib: ["ES2022"]` (still no `"DOM"` — `fetch`/
`AbortSignal` types come from a Node-18-era `@types/node`). Both majors keep `module:
"CommonJS"` so both stay `main`-resolvable without a dual ESM/CJS build.

## 5. Documented divergences from the Java SDK

Root `CLAUDE.md` requires shared endpoint behavior, wire fields, severity mapping, and
retry classification across languages — it does not require identical method shapes,
error-handling idioms, or internal knobs. These are the deliberate, disclosed
differences from Java, each decided explicitly rather than left as an accident:

- **3 retries, not 5** (`[500, 1000, 2000]` ms vs. Java's `[500,1000,2000,4000,8000]`) —
  same doubling shape, a lower total retry budget by design.
- **No jitter** — this one actually *matches* Java, which documents fixed, jitter-free
  delays as an intentional V1 choice.
- **Retry/timeout constants are fixed internals, not public config** — no
  `maxRetries`/`initialDelayMs`/`timeoutMs` knobs on the constructor or either send
  method. Matches Java's explicit V1 stance (`java/CLAUDE.md` §2, §5.2): "Do not add
  timeout, queue, executor, proxy, serializer, connection-pool, or retry knobs to the V1
  public builder without an explicit product/API decision."
- **`sendIncident`/`sendIncidentAsync` never throw or reject, under any circumstance** —
  the single biggest divergence. Java's `post()` throws `IncidentException` on delivery
  failure and validation errors throw at the builder. Here, an invalid request, a
  closed-client call, a delivery failure after retries exhaust, and an unexpected
  internal error all resolve as a failed `IncidentResponse` (`successful: false, code:
  -1` when no real HTTP status exists, or the real status code when one was received)
  or, for `sendIncidentAsync`, are simply logged. This is deliberate: an
  incident-reporting call is most often made from inside a `catch` block already
  handling a different failure. A reporting call that can itself throw risks turning a
  handled failure into an unhandled process crash — the same reasoning that makes
  Sentry/Datadog/Bugsnag-style observability SDKs guarantee they cannot themselves
  crash the host, unlike transactional SDKs (Stripe, AWS) where throwing is correct
  because the caller's business logic depends on the precise failure.
- **`InvalidRequestError`/`ClientClosedError` are internal-only** — used to shape log
  messages and response `message` fields, never thrown across the public boundary,
  never exported. There is no Java-`IncidentException` equivalent and no `instanceof`
  check a consumer would need. The one exception: the `IncidentClient` **constructor**
  still throws synchronously on a missing/blank `apiKey`/`serviceKey`/`tenant` — matches
  Java's builder validating at `build()`, and the "never throws" guarantee is scoped to
  the two send methods, not to misusing the constructor itself.
- **`sendIncidentAsync` accepts optional `onSuccess`/`onError` callbacks** — a pure
  observation hook invoked synchronously from inside the same catch-everything path;
  supplying them (or not) never changes the never-throws guarantee. Java's
  `postAsync()` has no equivalent — it only logs.
- **No enforceable connection-pool cap on the `fetch`-based major.** Java bounds
  concurrent connections to 20 via `PoolingHttpClientConnectionManager`. Node's global
  `fetch` (undici-backed) exposes no public, dependency-free way to cap concurrent
  connections without adding `undici` as an explicit dependency — which would break
  "fetch only, zero runtime deps." `release/1.x`'s `http`/`https` transport does mirror
  Java's pool sizing via `new https.Agent({ keepAlive: true, maxSockets: 20 })`.
- **`ATTEMPT_TIMEOUT_MS = 8000`** collapses Java's separate 3s-connect/5s-socket
  timeouts into one attempt deadline in both majors — retry classification doesn't
  depend on the split, only latency shape does.
- **Retryable-status classification matches Java's precise list**, not "any 5xx": 429,
  500, 502, 503, 504 retryable; 400, 401, 403, 404, 409, 422 explicitly non-retryable;
  everything else (e.g. 501, 505) non-retryable, per Java's "all other statuses are
  non-retryable unless the policy is deliberately updated" rule.
- **Final-failure logging matches Java's exact asymmetry, not a blanket rule.**
  `RetryExecutor.executeWithRetry`'s `withAttemptCountIfNetworkFailure` appends
  `"(after N attempts)"` to a failure's message **only** when a network-level failure
  (`code: -1` — the same "no real HTTP response involved" sentinel Java's
  `IncidentException.getStatusCode()` documents) exhausts retries — this mirrors
  `RetryExecutor.java`'s `IOException` branch exactly. An HTTP-status failure
  (`code !== -1`) that exhausts retries is rethrown with its original message
  unchanged, matching Java's `IncidentException` branch, which never gets attempt-count
  wording even after exhausting retries. An immediately non-retryable failure (401,
  400, etc.) never enters the retry loop at all, so it never gets this wording either.
  Individual retry attempts are still never logged — only this one, final log line can
  carry an attempt count, per `java/CLAUDE.md` §10's "not separately for each attempt"
  rule.
- **`ENDPOINT_URL` reads `process.env.OPPEX_TEST_ENDPOINT_URL` before falling back to
  the real endpoint** (`src/constants.ts`). This is a test-only seam, not public API —
  it isn't a constructor parameter, isn't part of the TypeScript public surface, and a
  consumer would never discover or rely on it by accident. It exists so integration
  tests can point the full delivery pipeline at a local loopback server, the same way
  Java's `HttpExecutorTest` runs against the JDK's local `HttpServer` rather than the
  real Oppex service — without adding a configurable-endpoint knob to the public
  `IncidentClientOptions` type, which `java/CLAUDE.md` §16 explicitly forbids doing
  "solely to simplify testing."

## 6. Directory layout

```text
javascript/
├── CLAUDE.md  README.md  LICENSE  package.json  tsconfig.json  .gitignore
├── scripts/
│   └── sync-release-1x.sh          # byte-identical across majors — see §8
├── src/
│   ├── index.ts                    # public exports only: IncidentClient, Severity, types
│   ├── IncidentClient.ts           # façade — byte-identical across majors
│   ├── constants.ts                # byte-identical across majors
│   ├── model/                      # Severity, IncidentRequest, IncidentResponse, errors — byte-identical
│   └── internal/
│       ├── retry/RetryExecutor.ts          # byte-identical
│       ├── async/{AsyncDispatcher,RateLimitedDropLogger}.ts   # byte-identical
│       ├── wire/wireCodec.ts               # byte-identical
│       ├── http/retryableStatus.ts         # byte-identical
│       └── transport.ts                    # *** the only file that differs per major ***
└── test/
    ├── smoke.js                    # network-free, plain CommonJS, Node-8-safe — the CI gate
    ├── model/                      # pure unit tests
    └── internal/                   # unit + local-loopback-server integration tests, byte-identical
```

## 7. Verification

```shell
npm install
npm run build
node test/smoke.js
node test/model/incidentRequest.test.js
node test/internal/wireCodec.test.js
node test/internal/retryExecutor.test.js
node test/internal/asyncDispatcher.test.js
node test/internal/transport.test.js
node test/IncidentClient.test.js
```

`test/smoke.js` must also pass when actually run under Node 8 — this is what the
`javascript-compatibility.yml` CI matrix checks per branch; it is deliberately
network-free (mirrors `.github/smoke/java/ExternalConsumer.java`) and written in plain,
conservative CommonJS so it needs no compilation step of its own and stays shared,
byte-identical, across both branches.

To confirm the Node-8 guardrail is real, not just present in config: on `release/1.x`,
temporarily add a `fetch(...)` call anywhere under `src/`, run `npm run build`, and
confirm it fails to compile. Revert before committing.

## 8. Keeping the two branches in sync

Nothing about git or npm automatically keeps the "must stay byte-identical" files
identical across `release/1.x` and `feat/node-sdk` — that has to be enforced
deliberately. `javascript/scripts/sync-release-1x.sh` does this:

```shell
javascript/scripts/sync-release-1x.sh check   # reports drift, exits 1 if any is found
javascript/scripts/sync-release-1x.sh sync    # copies feat/node-sdk's shared files onto
                                                # release/1.x, rebuilds, runs the full
                                                # test suite, and commits only if it passes
```

`check` runs in CI on every push (see `javascript-compatibility.yml`'s `sync-check`
job), so a shared-file edit made on only one branch is caught within minutes, not
whenever someone eventually hits a bug that only reproduces on one branch. `sync` is a
local, manual step — after changing any shared file on `feat/node-sdk`, run it to
propagate the change onto `release/1.x` before pushing either branch. It refuses to run
against a dirty working tree, and refuses to commit if the rebuilt, resynced
`release/1.x` fails its own test suite.

This script is itself one of the files that must stay byte-identical between branches —
if you change it, apply the same change to both.
