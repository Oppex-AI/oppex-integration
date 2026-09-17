# GitHub Automation Guide

Read the repository-level `CLAUDE.md` before changing automation.

This directory contains repository automation and consumer smoke sources. It is not packaged into SDK artifacts.

## Rules

- Workflows use read-only repository permissions unless a job has a documented need for more.
- Pin official actions to reviewed major versions.
- Keep the Java compatibility matrix aligned with the supported JDK list, and the Python matrix aligned with the supported interpreter list.
- Never put API keys, Maven Central credentials, or signing material directly in workflow YAML.
- Compatibility tests must remain network-free after dependencies, JDK tooling, and container images are downloaded. Loopback is allowed.
- The uploaded Java artifact must be the non-executable `java/sdk-bundle` library, never an example application JAR.
- The uploaded Python artifacts must be the universal `py2.py3-none-any` wheel and its sdist from `python/dist`, with no declared runtime dependencies and no console entry point.
- `.github/smoke/java` sources use only supported SDK API and Java 7 language syntax.
- The bundled Java JAR must contain no third-party package under its original
  name. The Java compatibility workflow enforces this, and the Java smoke
  consumer asserts each bundled dependency loads only under its
  `dev.oppex.sdk.shaded` name.
- `.github/smoke/python` sources use only supported SDK API and Python 2.7-compatible syntax.
- Workflow files stay at repository root, but language-specific commands and artifacts must be explicitly scoped to their peer language directory.
- Do not hide a failing matrix entry with `continue-on-error`.
- Java Central releases use stable `java-vX.Y.Z` tags and must pass the complete
  Java compatibility workflow before publishing. Python PyPI releases use stable
  `python-vX.Y.Z` tags and must pass the complete Python compatibility workflow
  before publishing. A tag must never trigger another language's release.
- Keep Central Portal and GPG credentials in the protected `maven-central`
  GitHub environment, and the PyPI API token in the protected `pypi`
  environment. Never echo, persist, upload, or pass any of them as command-line
  arguments. An environment secret is reachable only by a job that declares that
  environment, which is why the publish jobs declare one. Prefer PyPI trusted
  publishing over a token when it can be configured; it needs `id-token: write`
  on the publishing job alone and leaves no credential to leak.
- Maven Central receives one Java 7-compatible release, not one classifier per
  tested JDK. Build the canonical JAR once on Java 7, checksum it, and run those
  exact bytes on every supported JDK. The publishing job may generate metadata
  on a newer JDK, but it must restore, compare, sign, and deploy the canonical
  Java 7 JAR without changing it.
- PyPI receives one universal Python 2.7-compatible release, not one artifact per
  tested interpreter. Build the wheel and sdist once inside `python:2.7-slim`,
  checksum them, run those exact bytes on every supported interpreter, and upload
  the same files without rebuilding.
- Python matrix jobs run their interpreter in a pinned `python:<version>-slim`
  container through `docker run`, with checkout and artifact steps on the host.
  Old interpreter images cannot be relied on to host the runner's Node process,
  so do not move these steps into a job-level `container:`.
- A container step that writes into the workspace runs as root; restore ownership
  before a later host step needs to write there.

GitHub CLI commands require this directory to be inside a Git repository with a configured GitHub remote.

## Per-language automation

Every implemented SDK has a `<language>-compatibility.yml` that is also
`workflow_call`-able, so its release workflow runs it first and reuses the
artifact it uploaded. Keep that shape when adding a language.

- `.github/smoke/go` is an isolated **consumer module**, not a package inside
  `golang/`. The `replace` directive in its `go.mod` is required rather than
  optional: the Go module proxy only serves a version that has already been
  tagged, so a pre-release check has nothing to fetch.
- `.github/smoke/rust` depends on `packaged-crate/`, which the workflow creates
  by extracting the `.crate` that `cargo package` produced. It must never be
  switched to a path into `rust/`: depending on the packaged copy is what
  catches a file missing from `Cargo.toml`'s `include` list.
- `.github/smoke/ruby` runs against the **built gem** installed into a throwaway
  `GEM_HOME`, never against `ruby/lib` on the load path, for the same reason
  applied to `gemspec.files`.
- `.github/smoke/dotnet` resolves a `PackageReference` from a local folder feed
  holding the packed `.nupkg`, with `nuget.org` cleared in its `nuget.config`.
  Clearing the feed is deliberate: otherwise a restore could silently succeed
  against an already-published package instead of the one under test.
- `.github/smoke/cpp` builds the **extracted release archive**, installs it, and
  resolves it with `find_package`. It builds one executable as C++ and one as C;
  the C one is what proves `oppex/oppex.h` is usable without a C++ compiler.

Release tags are language-qualified, and every publish job re-checks that the tag
matches the version recorded in the SDK's own manifest before publishing:

| Language | Tag | Destination |
| --- | --- | --- |
| Java | `java-vX.Y.Z` | Maven Central |
| Python | `python-vX.Y.Z` | PyPI |
| Rust | `rust-vX.Y.Z` | crates.io |
| Ruby | `ruby-vX.Y.Z` | RubyGems |
| .NET | `dotnet-vX.Y.Z` | NuGet |
| C and C++ | `cpp-vX.Y.Z` | GitHub Release artifacts |
| Go | `golang/vX.Y.Z` | the Go module proxy; no publish job |

Two of those break the pattern for real reasons, not by oversight:

- **Go's tag carries the directory prefix**, because Go requires a subdirectory
  module's tags to be `<dir>/vX.Y.Z` and the proxy will not resolve the module
  otherwise. There is no Go publish workflow at all: the proxy serves source
  straight from the repository, so a release is the tag and nothing else.
- **C and C++ publish to a GitHub Release**, because there is no canonical
  registry for them. The published artifact is the source archive
  `cpp/scripts/package.sh` builds, plus its SHA-256. `cpp-release.yml` is the
  only job in this repository that requests `contents: write`, and only to create
  the release its tag names.

`cargo` has no "upload this file" mode, so `rust-publish.yml` repackages from the
same commit and fails the release unless the new `.crate`'s checksum matches the
one the compatibility workflow verified. Do not replace that check with a copy of
the artifact into `target/package/`: `cargo publish` repackages regardless, so
the copy would prove nothing.

Registry credentials live in protected environments — `crates-io`, `rubygems`,
`nuget` — alongside the existing `maven-central` and `pypi`. Prefer trusted
publishing over a long-lived key wherever the registry supports it.
