# Oppex Integration SDK Monorepo Guide

This is the durable repository-level guide. Read it before changing shared automation or adding a language SDK. When working within a language directory, also read that directory's `CLAUDE.md` and every more-specific guide on the path to the file being changed.

## Mission

This repository houses equivalent Oppex integration libraries for multiple programming languages. Each SDK should present conventions natural to its language while preserving the shared incident-delivery contract and keeping release lifecycles independent.

The Java SDK was the first implementation and lives entirely under `java/`. The Python SDK followed and lives entirely under `python/`. A Node.js implementation lives entirely under `node/`. Go, Rust, Ruby, .NET, and C/C++ implementations followed, under `golang/`, `rust/`, `ruby/`, `dotnet/`, and `cpp/`. Any further language must be added as a peer directory rather than mixed into an existing SDK's build.

## Repository layout

```text
oppex-integration/
├── .github/
│   ├── workflows/          # Repository-discovered CI definitions
│   └── smoke/              # Language-specific isolated consumers
├── java/                   # Complete Java SDK project
│   ├── pom.xml
│   ├── sdk-core/
│   ├── sdk-http/
│   ├── sdk-bundle/
│   └── examples/
├── python/                 # Complete Python SDK project
│   ├── setup.py
│   ├── src/oppex_sdk/
│   ├── tests/
│   ├── scripts/
│   └── examples/
├── node/                   # Complete Node.js SDK project
│   ├── package.json
│   ├── src/
│   ├── test/
│   └── scripts/
├── golang/                 # Complete Go SDK project
│   ├── go.mod
│   ├── oppex/
│   └── examples/
├── rust/                   # Complete Rust SDK project
│   ├── Cargo.toml
│   ├── src/
│   ├── tests/
│   └── examples/
├── ruby/                   # Complete Ruby SDK project
│   ├── oppex_sdk.gemspec
│   ├── lib/oppex_sdk/
│   ├── test/
│   └── examples/
├── dotnet/                 # Complete .NET SDK project
│   ├── Oppex.Integration.Sdk.slnx
│   ├── src/
│   ├── tests/
│   └── examples/
├── cpp/                    # Complete C and C++ SDK project
│   ├── CMakeLists.txt
│   ├── include/oppex/
│   ├── src/
│   ├── tests/
│   ├── examples/
│   └── scripts/
├── .gitignore
├── README.md
└── CLAUDE.md
```

Only create a future language directory when implementation work begins. Empty placeholder directories are not committed by Git and should not be added merely to reserve names.

`golang/` rather than `go/` because a directory named `go` at a module path root confuses several Go tools; `cpp/` holds both the C++ library and its C ABI, since they are one build producing one library.

## Structural decisions

### Language isolation

Every language SDK owns its source tree, package-manager metadata, lockfiles, tests, examples, compatibility policy, and release configuration. One SDK must not require another SDK's toolchain to build or test.

Do not place a Maven module, Python package, Node workspace, Go module, Cargo manifest, gemspec, MSBuild project, or top-level `CMakeLists.txt` at repository root. Their build roots belong in `java/`, `node/`, `python/`, `golang/`, `rust/`, `ruby/`, `dotnet/`, and `cpp/` respectively.

The Java SDK bundles Apache HttpClient and Jackson, relocated under `dev.oppex.sdk.shaded` so the bundle cannot shadow a consuming application's own copies; the Python, Go and Ruby SDKs are standard library only; the Rust SDK depends on `ureq`, `serde_json` and `log`; the .NET SDK on `Microsoft.Extensions.Logging.Abstractions`; the C/C++ SDK on libcurl. Neither fact may leak into another's build, and a shared dependency choice is never assumed across languages.

### Shared root responsibilities

Repository root is limited to:

- language-neutral documentation and contribution policy;
- `.gitignore` and other genuinely shared configuration;
- `.github/` automation and isolated CI consumers;
- peer language SDK directories.

GitHub workflow YAML must remain under root `.github/workflows/`; GitHub does not discover workflows stored inside `java/`, `python/`, or another language directory. Workflow commands and artifact paths must explicitly include the language directory.

### Independent releases

Language SDKs may use different version numbers and release cadences. Do not assume a Java artifact version is also the Python, npm, or Go module version. Release jobs must identify both the language and package being published.

Release tags are language-qualified: `java-vX.Y.Z` publishes to Maven Central, `python-vX.Y.Z` to PyPI, `rust-vX.Y.Z` to crates.io, `ruby-vX.Y.Z` to RubyGems, `dotnet-vX.Y.Z` to NuGet, and `cpp-vX.Y.Z` attaches a source archive to a GitHub Release. A tag must never trigger another language's release.

Go is the one exception to the tag format, and it is a Go requirement rather than a preference: a module in a subdirectory is only resolvable from a tag carrying that directory prefix, so the Go SDK releases as `golang/vX.Y.Z`. It has no publish workflow at all, because the module proxy serves source straight from the repository.

### Shared API semantics, idiomatic surfaces

SDKs should agree on endpoint behavior, authentication headers, incident fields, severity mapping, retry classification, and lifecycle guarantees. They do not need identical class or method shapes. Use idiomatic constructs for each language and document intentional semantic differences.

### No shared generated runtime code by default

Do not introduce a cross-language generator, schema compiler, or shared runtime abstraction until at least two implemented SDKs demonstrate a concrete maintenance problem that it solves. A language-neutral API contract may be added later, but generated output and regeneration instructions must remain deterministic and reviewed per SDK.

## Current language guides

- Java: [`java/CLAUDE.md`](java/CLAUDE.md)
- Node.js: [`node/CLAUDE.md`](node/CLAUDE.md)
- Python: [`python/CLAUDE.md`](python/CLAUDE.md)
- Go: [`golang/CLAUDE.md`](golang/CLAUDE.md)
- Rust: [`rust/CLAUDE.md`](rust/CLAUDE.md)
- Ruby: [`ruby/CLAUDE.md`](ruby/CLAUDE.md)
- .NET: [`dotnet/CLAUDE.md`](dotnet/CLAUDE.md)
- C and C++: [`cpp/CLAUDE.md`](cpp/CLAUDE.md)
- GitHub automation: [`.github/CLAUDE.md`](.github/CLAUDE.md)

## Shared contract decisions

Every SDK agrees on these, and a change to any of them is a cross-language change:

- Endpoint `POST https://api.oppex.ai/api/v1/incident/post`, authenticated with the `X-API-KEY` header.
- Payload fields `serviceKey`, `title`, `source`, `severity`, `priority`, `srcTimestamp`, `component`, `group`, `type`, `detailsJSON`. An absent optional field is omitted rather than sent as null.
- Severity is the numeric scale 1 (lowest) through 5 (highest); priority is 1 through 5. `srcTimestamp` is milliseconds since the Unix epoch.
- `source` is required and capped at 255 characters.
- A request's own service key overrides the client's. Service routing omits the service key entirely and refuses a request that carries one.
- HTTP 429, 500, 502, 503 and 504, plus transport failures that never reached a status line, retry with a 0.5s, 1s, 2s, 4s, 8s backoff. Every other status fails immediately.
- 3 second connect timeout, 5 second socket timeout.
- Asynchronous delivery is best effort through a queue bounded at 5000 that drops the oldest entry under saturation, and a close drains for up to 10 seconds before abandoning the rest.

Each SDK documents its own idiomatic surface and any intentional deviation in its language guide.

## Adding a language SDK

When adding a new SDK:

1. Create the canonical peer directory (eg `kotlin/`), named after the language rather than an implementation.
2. Add a language README with installation, usage, build, test, and release instructions.
3. Add a language-root `CLAUDE.md` recording compatibility floors, public API boundaries, dependencies, concurrency/lifecycle behavior, packaging, and directory ownership.
4. Keep source, tests, examples, dependency metadata, and generated outputs within that directory.
5. Add a root workflow whose commands are scoped to that directory, plus a release workflow if the language has a registry to publish to.
6. Add an isolated consumer under `.github/smoke/<language>/` that uses only the published artifact surface.
7. Use language-qualified workflow and artifact names so matrix outputs cannot collide.
8. Update this guide and the root README with the implemented status and any shared contract decision.

## Change-management rules

- Preserve unrelated language SDKs when making a language-specific change.
- Run the focused language build before the full set of affected workflows.
- Never commit generated build directories such as Maven `target/`, Python virtual environments, Node `node_modules/`, or Go build caches.
- Never place credentials, signing keys, registry tokens, or API keys in source or workflow YAML.
- Keep compatibility failures visible; do not use `continue-on-error` to make a supported runtime optional.
- Update the nearest `CLAUDE.md` whenever a structural, compatibility, packaging, or lifecycle decision changes.

## Compatibility-floor pattern

The Java, Python and Node.js SDKs each support a runtime far older than their build tooling prefers, and all three prove it the same way. Reuse this shape for a new SDK with an old floor rather than inventing another:

1. Build one canonical artifact on the oldest supported runtime.
2. Checksum it and upload it once.
3. Run those exact bytes on every supported runtime in a matrix, compiling and executing an external consumer that uses only the published API.
4. Publish the same bytes, without rebuilding them, from a tag-triggered job.

Java runs its matrix with `actions/setup-java`; Python runs its matrix in pinned `python:<version>-slim` containers so no job depends on which interpreters a runner image happens to ship.

### Current-stable-only SDKs

The Go, Rust, Ruby, .NET and C/C++ SDKs deliberately support the **current stable release of their language only**. They carry no older-runtime compatibility floor, and the version-sweep half of the pattern above collapses to a single entry — or, for C/C++, to a compiler sweep rather than a version sweep, because there is no single "C++ runtime version" to pin.

What does not collapse is steps 1, 2 and 4. Every one of these SDKs still builds one canonical artifact, checksums it, verifies **those bytes** against an isolated external consumer, and publishes the same bytes without rebuilding:

| SDK | Canonical artifact | What the consumer proves |
| --- | --- | --- |
| Rust | the `.crate` from `cargo package` | nothing is missing from `Cargo.toml`'s `include` list |
| Ruby | the `.gem`, installed into a throwaway `GEM_HOME` | nothing is missing from `gemspec.files` |
| .NET | the `.nupkg`, restored from a local feed with nuget.org cleared | the package, not a project reference, is usable |
| C and C++ | the source archive from `cpp/scripts/package.sh` | nothing is missing from the archive, and the install rules work |
| Go | none: the proxy serves source | an outside module resolves the SDK by its real import path |

Each matrix pins "current stable" by name rather than by number — `stable` for Go and Rust, `ruby` for Ruby — so the policy is expressed once instead of being a version someone has to keep editing.

Do not add an older runtime to one of these matrices without first recording the decision in that SDK's `CLAUDE.md`. Supporting an old floor is the expensive, deliberate choice the first three SDKs made for reasons their own guides explain; it is not a default.

## Java relocation decision

The initial repository contained only Java and therefore used Maven modules at root. It was converted to a language monorepo before adding other SDKs. All Java build files, sources, examples, and Java-specific documentation moved under `java/`. Root workflows remained in `.github/workflows/` and were updated to reference `java/` explicitly. This boundary must not be reversed by placing new Java modules back at repository root.
