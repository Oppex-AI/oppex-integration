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

## 2. Two variants, one branch, no git divergence

Real Node deployments in this SDK's support range span Node 8 through 26. Node 18 is
the one capability boundary in that whole range with comparable significance to
anything else (native `fetch`/`AbortController`/Web Streams) — there is no second
boundary worth a third variant. This SDK ships as two npm majors:

- **`@oppex/integration-sdk@^1`** ("legacy") — `engines.node >=8`. Transport: core
  `http`/`https`, manual timeout (`req.setTimeout()` + `req.destroy()`). No
  `AbortController` even for the Node 15–17 portion of this variant's range — one
  uniform mechanism across the whole 8–17 span avoids an unnecessary internal branch.
- **`@oppex/integration-sdk@^2`** ("modern") — `engines.node >=18`. Transport: global
  `fetch` only, no `http`/`https` code at all.

Earlier revisions of this SDK maintained these as two separately-pushed git branches,
kept in sync by a script. That structure is gone. Both variants now live in **one
branch** (`master`), as files:

- `node/src/internal/transport.legacy.ts` / `transport.modern.ts` — the one piece of
  real logic that differs
- `node/variants/legacy/` / `node/variants/modern/` — each holding that variant's
  `package.json`, `package-lock.json`, `tsconfig.json`

Everything else — `IncidentClient.ts`, `RetryExecutor.ts`, `AsyncDispatcher.ts`, every
model, every test — exists exactly once. There is nothing left to keep in sync, because
there is no longer a second copy of anything to drift. `node/scripts/build-variant.sh
<legacy|modern>` stages the requested variant's files into their canonical top-level
locations and builds — see §6.

**Maintenance policy**: "legacy" receives security/critical patches only. "modern" is
where active feature development happens. This is standard practice (same as
Stripe/Twilio/AWS SDK version-floor raises), not a permanent commitment to maintaining
two diverging feature sets — a genuinely new capability boundary (a future Node LTS
introducing something comparable to `fetch`) would justify a third variant later,
following the same reasoning, not a speculative one added now.

## 3. Why flat, not core/http/bundle like Java

Java's `sdk-core`/`sdk-http`/`sdk-bundle` split exists to solve two Java-specific
problems this SDK doesn't have: avoiding a circular dependency between the public
façade and its only implementation, and shading third-party runtime dependencies
(Apache HttpClient, Jackson) into one fat jar so consumers don't resolve transitive
Maven coordinates or risk classpath collisions. This SDK has **zero runtime
dependencies** in both variants — nothing to shade, no transitive graph to hide, no
classpath collision risk. npm's own module resolution already gives consumers one
importable unit. A model-only sub-package would be pure ceremony with no consumer
benefit.

## 4. The Node-8 guardrail: `lib` + `@types/node`, not just `target`

`target` only downlevels *syntax* — it does nothing about *runtime* API availability.
Modern-looking TypeScript that calls `fetch()`, `AbortController`, `Array.prototype.at`,
or `Object.fromEntries` will compile cleanly and crash at runtime on Node 8 unless
something catches it at compile time. `node/variants/legacy/tsconfig.json` uses `target:
"ES2017"` (Node 8's real syntax ceiling — not ES2022, whose private-fields/static-block
syntax isn't all safely downlevelable) and `lib: ["ES2017"]` with no `"DOM"`, so those
globals have **no ambient type declarations** during that variant's build — calling one
is a compile error, not a silent Node-8 crash. This is the direct equivalent of Java's
`animal-sniffer` check (`java/CLAUDE.md` §12) — never remove it to make a change
compile; a build succeeding on a newer Node dev machine proves nothing about actual
Node 8 runtime compatibility.

One extra piece the single-branch layout requires that two separate branches didn't:
each variant's `tsconfig.json` **excludes the other variant's transport source file**
(`"exclude": ["src/internal/transport.modern.ts"]` in the legacy config, and the mirror
in the modern one). Without this, `tsc`'s `"include": ["src/**/*"]` glob picks up both
`transport.legacy.ts` and `transport.modern.ts` regardless of which one is actually
being built, so building "legacy" would fail to compile "modern"'s `fetch()` call even
though nothing imports it for that build — caught by testing this exact scenario before
trusting the design.

The pinned `@types/node` version on the legacy variant matters precisely:
`@types/node@8.10.66` and `@types/node@10.17.60` (the last published patches of those
lines) **fail to compile at all** under a current TypeScript compiler — DefinitelyTyped
never backported a later `Uint8Array`-generics compatibility fix to those frozen lines,
so `Buffer`'s declaration conflicts with `lib.es2017.d.ts`'s `Uint8Array` regardless of
anything this SDK does. `@types/node@14.18.63` compiles fine but already declares a
global `AbortController` (a real Node 15+ API) — DefinitelyTyped had folded that global
into every still-maintained major's latest patch by the time it shipped, so it doesn't
enforce the Node 8–14 boundary despite compiling. **`@types/node@12.20.55`** (pinned to
its own last published patch) is the version that actually enforces the boundary: it
compiles cleanly under TypeScript 5.5, and correctly fails to compile a `fetch(...)` or
`new AbortController()` call anywhere in the legacy transport source with `Cannot find
name` — the guardrail blocks both, not just one.

The modern variant uses `target: "ES2022"`, `lib: ["ES2022"]` (still no `"DOM"` —
`fetch`/`AbortSignal` types come from a Node-18-era `@types/node`). Both variants keep
`module: "CommonJS"` so both stay `main`-resolvable without a dual ESM/CJS build.

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
- **No enforceable connection-pool cap on the modern (`fetch`-based) variant.** Java
  bounds concurrent connections to 20 via `PoolingHttpClientConnectionManager`. Node's
  global `fetch` (undici-backed) exposes no public, dependency-free way to cap
  concurrent connections without adding `undici` as an explicit dependency — which
  would break "fetch only, zero runtime deps." The legacy variant's `http`/`https`
  transport does mirror Java's pool sizing via `new https.Agent({ keepAlive: true,
  maxSockets: 20 })`.
- **`ATTEMPT_TIMEOUT_MS = 8000`** collapses Java's separate 3s-connect/5s-socket
  timeouts into one attempt deadline in both variants — retry classification doesn't
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
node/
├── CLAUDE.md  README.md  LICENSE  .gitignore
├── package.json  package-lock.json  tsconfig.json    # GENERATED — gitignored, never
│                                                        the source of truth (see below)
├── scripts/
│   ├── build-variant.sh <legacy|modern>    # stage + install + build + full test suite
│   └── release.sh <legacy-ver|-> <modern-ver|->
├── variants/
│   ├── legacy/       package.json, package-lock.json, tsconfig.json (Node >=8 floor)
│   └── modern/       package.json, package-lock.json, tsconfig.json (Node >=18 floor)
├── src/
│   ├── index.ts                          # public exports only: IncidentClient, Severity, types
│   ├── IncidentClient.ts                 # façade — one copy, shared by both variants
│   ├── constants.ts
│   ├── model/                            # Severity, IncidentRequest, IncidentResponse, errors
│   └── internal/
│       ├── retry/RetryExecutor.ts
│       ├── async/{AsyncDispatcher,RateLimitedDropLogger}.ts
│       ├── wire/wireCodec.ts
│       ├── http/retryableStatus.ts
│       ├── transport.legacy.ts           # committed source for the legacy variant
│       ├── transport.modern.ts           # committed source for the modern variant
│       └── transport.ts                  # GENERATED by build-variant.sh — a symlink to
│                                            whichever variant ran last, not a copy
└── test/
    ├── smoke.js                          # network-free, plain CommonJS, Node-8-safe — the CI gate
    ├── model/                            # pure unit tests
    └── internal/                         # unit + local-loopback-server integration tests
```

`transport.legacy.ts` and `transport.modern.ts` live directly under `src/internal/`, at
the same depth as the staged `transport.ts` target — not nested a level deeper —
specifically so their relative imports (`../constants`) resolve identically whether
read from their own filename or through the symlink. `transport.ts` is a symlink
rather than a copy, since `tsc`/Node only ever read through it, never write to it —
`package.json`/`package-lock.json` stay plain copies instead, since npm can rewrite
those, and a symlink there risks silently detaching if some tool replaces the file via
write-to-temp-then-rename.

## 7. Building and testing

```shell
node/scripts/build-variant.sh legacy    # or modern
```

This stages that variant's `package.json`/`package-lock.json`/`tsconfig.json`/
`transport.ts` into their canonical top-level locations, then runs `npm install`,
`npm run build`, and the full test suite:

```shell
node test/smoke.js
node test/model/incidentRequest.test.js
node test/internal/wireCodec.test.js
node test/internal/retryExecutor.test.js
node test/internal/asyncDispatcher.test.js
node test/internal/transport.test.js
node test/IncidentClient.test.js
```

`test/smoke.js` must also pass when actually run under Node 8 — this is what
`node-compatibility.yml`'s CI matrix checks per variant; it is deliberately
network-free (mirrors `.github/smoke/java/ExternalConsumer.java`) and written in plain,
conservative CommonJS so it needs no compilation step of its own.

A fresh clone has no top-level `package.json`/`tsconfig.json` until you run
`build-variant.sh` once — they're generated, not committed. Run
`node/scripts/build-variant.sh modern` right after cloning to get a normal local dev
setup (editor/IDE support, etc.); switch to `legacy` any time you need to verify that
variant specifically.

To confirm the Node-8 guardrail is real, not just present in config: temporarily add a
`fetch(...)` call to `src/internal/transport.legacy.ts`, run `build-variant.sh legacy`,
and confirm it fails to compile. Revert before committing.

## 8. Cutting a release

`node/scripts/release.sh <legacy-version|-> <modern-version|->` releases either or both
variants in one invocation, **on the current branch — in practice, always `master`,
the only long-lived branch this SDK has.** No branch switching happens:

```shell
node/scripts/release.sh 1.0.1 2.1.0   # release both
node/scripts/release.sh 1.0.1 -       # "-" skips a variant
```

For each variant released, in order:

1. Bump `node/variants/<variant>/package.json`'s version
2. Build + test that variant (`build-variant.sh <variant>`) — *before* committing, so a
   bad bump never lands
3. Copy the resulting, version-synced `package-lock.json` back to
   `node/variants/<variant>/package-lock.json` (`npm install` updates the *staged*,
   gitignored lockfile's own version field automatically; without this copy-back step
   that update would be silently lost)
4. Commit the bump directly on the current branch
5. Create `node-release-<version>` as a branch pointing at that exact commit —
   deliberately a plain `git branch`, no checkout. This is a **snapshot taken after the
   bump**, not something `master` needs to catch up to later; there is no "merge the
   release branch back" step, because master was never behind it.

It refuses a dirty working tree (checked once, up front), a version that isn't a plain
`X.Y.Z` semver, a version that isn't strictly newer than that variant's current one, an
already-existing release branch, or a failing test run — and stops immediately, before
touching the second variant, if the first one's release fails for any reason. Branch
names are language-qualified (`node-release-X.Y.Z`), per root `CLAUDE.md`'s rule that
workflow, artifact, and branch/tag names must be language-qualified so they can't
collide with a future Python or Go SDK's own version markers.

After it finishes, it prints the exact push/publish commands — running them stays a
deliberate, separate, manual step:

```shell
git push origin master
git push origin node-release-1.0.1
git checkout node-release-1.0.1 && (cd node && ./scripts/build-variant.sh legacy && npm publish --tag legacy)
```

One non-obvious but important detail baked into that printed guidance: **a legacy
publish must always use `npm publish --tag legacy`**, never bare `npm publish`. Without
it, npm's `latest` dist-tag tracks *most recently published*, not *highest version* —
publishing a 1.x patch after 2.x is already out would silently move `latest` backward,
so a bare `npm install @oppex/integration-sdk` (no version specified) would install the
older major. Only a modern-variant publish should ever go to bare `latest`.

There is no automated guard preventing a legacy release from being given a version in
the `2.x.x` (or higher) range that semantically belongs to the modern variant's
lineage — `release.sh` only checks "newer than this variant's own current version," not
"does this number belong to the other variant." That discipline is manual.

A failed release attempt leaves a dirty working tree by design (the version bump is
written to disk before the test suite runs) — `git checkout -- node/variants/<variant>/
package.json` before retrying.
