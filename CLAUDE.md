# Oppex Integration SDK Monorepo Guide

This is the durable repository-level guide. Read it before changing shared automation or adding a language SDK. When working within a language directory, also read that directory's `CLAUDE.md` and every more-specific guide on the path to the file being changed.

## Mission

This repository houses equivalent Oppex integration libraries for multiple programming languages. Each SDK should present conventions natural to its language while preserving the shared incident-delivery contract and keeping release lifecycles independent.

The Java SDK was the first implementation. It lives entirely under `java/`. Future Python, JavaScript/TypeScript, and Go implementations must be added as peer directories rather than mixed into the Java Maven reactor.

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
├── python/                 # Future Python SDK
├── javascript/             # Future JavaScript/TypeScript SDK
├── golang/                 # Future Go SDK
├── .gitignore
├── README.md
└── CLAUDE.md
```

Only create a future language directory when implementation work begins. Empty placeholder directories are not committed by Git and should not be added merely to reserve names.

## Structural decisions

### Language isolation

Every language SDK owns its source tree, package-manager metadata, lockfiles, tests, examples, compatibility policy, and release configuration. One SDK must not require another SDK's toolchain to build or test.

Do not place Maven modules, Python packages, Node workspaces, or Go modules at repository root. Their build roots belong in `java/`, `python/`, `javascript/`, or `golang/` respectively.

### Shared root responsibilities

Repository root is limited to:

- language-neutral documentation and contribution policy;
- `.gitignore` and other genuinely shared configuration;
- `.github/` automation and isolated CI consumers;
- peer language SDK directories.

GitHub workflow YAML must remain under root `.github/workflows/`; GitHub does not discover workflows stored inside `java/` or another language directory. Workflow commands and artifact paths must explicitly include the language directory.

### Independent releases

Language SDKs may use different version numbers and release cadences. Do not assume a Java artifact version is also the Python, npm, or Go module version. Release jobs must identify both the language and package being published.

### Shared API semantics, idiomatic surfaces

SDKs should agree on endpoint behavior, authentication headers, incident fields, severity mapping, retry classification, and lifecycle guarantees. They do not need identical class or method shapes. Use idiomatic constructs for each language and document intentional semantic differences.

### No shared generated runtime code by default

Do not introduce a cross-language generator, schema compiler, or shared runtime abstraction until at least two implemented SDKs demonstrate a concrete maintenance problem that it solves. A language-neutral API contract may be added later, but generated output and regeneration instructions must remain deterministic and reviewed per SDK.

## Current language guides

- Java: [`java/CLAUDE.md`](java/CLAUDE.md)
- GitHub automation: [`.github/CLAUDE.md`](.github/CLAUDE.md)

## Adding a language SDK

When adding a new SDK:

1. Create the canonical peer directory (`python/`, `javascript/`, or `golang/`).
2. Add a language README with installation, usage, build, test, and release instructions.
3. Add a language-root `CLAUDE.md` recording compatibility floors, public API boundaries, dependencies, concurrency/lifecycle behavior, packaging, and directory ownership.
4. Keep source, tests, examples, dependency metadata, and generated outputs within that directory.
5. Add a root workflow whose commands are scoped to that directory.
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

## Java relocation decision

The initial repository contained only Java and therefore used Maven modules at root. It was converted to a language monorepo before adding other SDKs. All Java build files, sources, examples, and Java-specific documentation moved under `java/`. Root workflows remained in `.github/workflows/` and were updated to reference `java/` explicitly. This boundary must not be reversed by placing new Java modules back at repository root.
