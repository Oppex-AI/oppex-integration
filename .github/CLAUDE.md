# GitHub Automation Guide

Read the repository-level `CLAUDE.md` before changing automation.

This directory contains repository automation and consumer smoke sources. It is not packaged into SDK artifacts.

## Rules

- Workflows use read-only repository permissions unless a job has a documented need for more.
- Pin official actions to reviewed major versions.
- Keep the Java compatibility matrix aligned with the supported JDK list.
- Never put API keys, Maven Central credentials, or signing material directly in workflow YAML.
- Compatibility tests must remain network-free after dependencies and JDK tooling are downloaded.
- The uploaded Java artifact must be the non-executable `java/sdk-bundle` library, never an example application JAR.
- `.github/smoke/java` sources use only supported SDK API and Java 7 language syntax.
- Workflow files stay at repository root, but language-specific commands and artifacts must be explicitly scoped to their peer language directory.
- Do not hide a failing matrix entry with `continue-on-error`.

GitHub CLI commands require this directory to be inside a Git repository with a configured GitHub remote.
