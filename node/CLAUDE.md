# Oppex Node.js SDK Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file records why the
Node.js SDK is structured as it is, which decisions are intentional, and how future
contributors and coding agents must evolve it without accidentally breaking Node
compatibility, the "never throws" delivery contract, or cross-language semantic parity
with the Java SDK.

For how a call actually flows through the SDK at runtime — component map, the
request-flow diagram, what each piece does — see
[`docs/architecture.md`](docs/architecture.md). That doc is the runtime-architecture
complement to this one; this file stays focused on structure, tooling, and the
reasoning behind specific decisions.

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
├── docs/
│   └── architecture.md                               # runtime architecture, component map
├── package.json  package-lock.json  tsconfig.json    # GENERATED — gitignored, never
│                                                        the source of truth (see below)
├── dist/  dist-legacy/  dist-modern/                 # GENERATED by build-variant.sh /
│                                                        build-all.sh respectively — gitignored
├── scripts/
│   ├── build-variant.sh <legacy|modern>    # stage + install + build + full test suite
│   ├── build-all.sh                        # both variants; run before raising a PR
│   └── docker-sanity.sh                    # local-only: real node:X containers, every version
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

`test/smoke.js` is deliberately network-free (mirrors
`.github/smoke/java/ExternalConsumer.java`) and written in plain, conservative
CommonJS so it needs no compilation step of its own — but the thing that actually
*proves* real Node-version compatibility in CI is the separate external-consumer step
covered below, not this in-repo run of `build-variant.sh`'s own test suite.

**CI runs bare, not in containers, and builds under one fixed Node — not
`matrix.node`.** `node-compatibility.yml`'s matrix provisions Node with
`actions/setup-node` directly on `ubuntu-latest`, rather than `container: image:
node:${{ matrix.node }}`. That container approach was tried first and reverted after it
caused two real failures:

1. `actions/checkout` runs as the runner's own user, but a container's `run:` steps
   execute as that image's own (different) user looking at the same checked-out files
   — which trips git's ownership check ("detected dubious ownership", the fix for
   CVE-2022-24765) and broke `build-variant.sh`'s own `git rev-parse --show-toplevel`
   call.
2. Once that was fixed and the Node 8 entry's build step actually ran for the first
   time, it hit a second, unrelated problem: **building requires a Node capable of
   running the TypeScript compiler package itself**, not just a Node new enough for
   this SDK's own `legacy`/`modern` output targets. TypeScript's own published bundle
   (`typescript/lib/tsc.js`) uses syntax — optional catch binding (`catch {}` with no
   parameter) — that Node 8's parser rejects outright. `container: image: node:8` would
   have hit this exact same `SyntaxError` the moment it got far enough to actually run
   `npm run build`; it never had before, because the ownership bug above always failed
   first.

The fix for both: the workflow now calls `actions/setup-node` **twice**. First, to a
fixed, modern version (`"22"`) for "Build and test the variant" and "Pack tarball" —
building has nothing to do with which Node this SDK targets, only with what's needed to
run the tooling. Then, immediately before the external-consumer steps, a second
`actions/setup-node` call switches to the real `matrix.node` — that's where actual
runtime compatibility gets proven, by installing the already-built tarball and running
it exactly the way a real consumer on that Node version would (never compiling it
themselves). `actions/setup-node` fetches any released Node version — including EOL
ones like 8 — straight from nodejs.org's dist archive, which never removes old
tarballs, so there's no coverage lost by building under a different, newer Node than
the one being verified.

One more version-drift trap this surfaced: the pnpm and yarn external-consumer steps
used to call bare `corepack enable`, which fetches whatever pnpm/yarn release is
currently latest. pnpm's own floor keeps rising independently of this repo — pnpm 11
requires Node ≥22.13, which broke this step outright on the Node 18 and 20 entries, a
failure with nothing to do with this SDK's own Node 18 floor. Both are now pinned via
`corepack prepare <pkg>@<version> --activate`: `pnpm@8.15.9` (supports Node ≥16.14,
covering every non-Node-8 matrix entry) and `yarn@1.22.22` (Yarn Classic, no
meaningful floor at all).

**What a container-based run actually still buys you** — the exact environment a
consumer's own Docker deployment would run in, not just "some Node binary of the right
version" — is preserved as a **local, not-CI** script instead:

```shell
node/scripts/docker-sanity.sh
```

Requires Docker running locally. Builds a fresh tarball per variant, then runs the same
network-free external consumer CI already trusts
(`.github/smoke/node/consumer.js`) inside the real `node:8`/`node:16`/.../`node:26`
images — the same version sweep `oppex-integration-testing/docker`'s compose file
already does for that separate sibling repo, folded into this one so it ships with the
SDK itself rather than living only in a testing repo someone has to know to check out
separately. It also re-runs the Node-8 anti-test (modern tarball on `node:8`, expected
to fail with a `SyntaxError`, not silently succeed) on every invocation. Run it before
cutting a release, or any time you want that stronger guarantee — it isn't wired into
CI, so nothing about the automated PR/push gate depends on Docker being available.

A fresh clone has no top-level `package.json`/`tsconfig.json` until you run
`build-variant.sh` once — they're generated, not committed. Run
`node/scripts/build-variant.sh modern` right after cloning to get a normal local dev
setup (editor/IDE support, etc.); switch to `legacy` any time you need to verify that
variant specifically.

To confirm the Node-8 guardrail is real, not just present in config: temporarily add a
`fetch(...)` call to `src/internal/transport.legacy.ts`, run `build-variant.sh legacy`,
and confirm it fails to compile. Revert before committing.

This check used to also run automatically in CI, deliberately mutating the source to
prove it fails — removed after that step turned out to have its own real bug: `tsc`
still writes JS output even when it reports a type error (`noEmitOnError` isn't set),
so the step's own `dist/` ended up corrupted with the injected `fetch()` call, and the
step never rebuilt afterward, so every following step (pack, install, run) reused that
broken output. Rather than patching a fragile "mutate the source and expect a failure"
mechanism, the guardrail is verified manually (as above) and otherwise trusted to the
structural guarantee it's actually built on — `lib: ["ES2017"]` with no ambient
`fetch`/`AbortController` declarations, not a runtime test of it.

## 8. Releasing: master only, no release branches

There is no `node-release-X.Y.Z` branch mechanism any more, and no script that commits
a version bump on your behalf. A release is just: bump a version as a normal reviewed
change, merge it to `master` the same way every other change lands, then publish
directly from `master`'s own history — nothing else to cut, branch, or reconcile
afterward.

**1. Bump the version(s) as part of your PR.** Edit
`node/variants/<variant>/package.json`'s `"version"` field directly — a plain, visible
line in the diff, reviewed like any other code change. Bump one or both variants in the
same PR if that's what the change calls for; they're independently versioned (root
`CLAUDE.md`'s "Independent releases"), so there's no requirement to bump both together.

**2. Before raising the PR, run:**

```shell
node/scripts/build-all.sh
```

Builds and tests **both** variants in one pass, and — this is the part that used to be
`release.sh`'s job — copies each variant's freshly regenerated `package-lock.json` back
to `node/variants/<variant>/package-lock.json`, so a version bump's lockfile update
actually lands in the diff instead of only ever existing in the gitignored, staged
copy. Review that lockfile diff alongside the version bump before committing. Output
lands in two independent, persistent directories — `node/dist-legacy/` and
`node/dist-modern/` — rather than the single `node/dist/` that `build-variant.sh`
leaves behind (which only ever holds whichever variant it last built); both are
gitignored, same as `dist/` itself.

**3. Merge to `master`** the normal way — reviewed PR, CI green, no direct pushes.
Nothing about steps 1–2 changes that; a version bump is not a special case that skips
review.

**4. Publish directly from `master`'s own history** — no branch to check out, because
there's nothing for a release branch to have snapshotted that `master` doesn't already
have once the PR is merged:

```shell
git checkout master && git pull
cd node
./scripts/build-variant.sh legacy && npm publish --tag legacy
./scripts/build-variant.sh modern && npm publish
```

**A legacy publish must always use `npm publish --tag legacy`**, never bare `npm
publish`. Without it, npm's `latest` dist-tag tracks *most recently published*, not
*highest version* — publishing a 1.x patch after 2.x is already out would silently move
`latest` backward, so a bare `npm install @oppex/integration-sdk` (no version
specified) would install the older major. Only a modern-variant publish should ever go
to bare `latest`.

There is no automated guard against giving the legacy variant a version number in the
`2.x.x`-or-higher range that semantically belongs to the modern variant's lineage, or
vice versa — that discipline stays manual, same as before.

## 9. `close()` and `CLOSE_DRAIN_TIMEOUT_MS`

`IncidentClient.close()` stops accepting new `sendIncidentAsync` work, lets
`AsyncDispatcher` keep draining whatever is already in flight or queued, then
force-drops anything still left once `CLOSE_DRAIN_TIMEOUT_MS` (10s) elapses.

That 10s figure is a deliberate, bounded-loss tradeoff, not a placeholder waiting to be
tuned upward. It is sized to fit inside Docker's default 10s container stop grace
period and leave headroom under Kubernetes' default 30s
`terminationGracePeriodSeconds` — the two most common environments this SDK actually
shuts down inside. Raising it to try to cover a worst-case retry chain (up to three
retries at up to 8s each) is counterproductive: the orchestrator SIGKILLs the process
at *its own* grace-period boundary regardless of what this constant says, so a longer
drain timeout just spends more of that same fixed window waiting instead of draining —
it does not create a higher chance of finishing. Some bounded incident loss during
shutdown is an accepted, deliberate cost of this design, not a defect to eliminate.

Calling `close()` at all is optional, not required for correctness. If nothing ever
calls it — an abrupt process exit, a crash, a `SIGKILL` — whatever is in flight or
queued is simply dropped immediately, the same default behavior as any other
unflushed in-memory client (e.g. a database connection pool that nobody explicitly
closed). `close()` exists to make an *orderly* shutdown better (drain what you can,
within a bound that respects the host's own grace period), not to make the *absence*
of one worse than it already would be.
