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
