# `sdk-core` Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file adds rules specific to `sdk-core`.

## Purpose

`sdk-core` contains the transport-independent supported API data types:

- `IncidentRequest`
- `IncidentResponse`
- `IncidentException`
- `Severity`

It must remain usable without Apache HttpClient and without any application framework. `sdk-http` depends on this module; this module must never depend on `sdk-http`.

## Dependency boundary

The main artifact should have no runtime dependency unless a model-level concern cannot reasonably be implemented with Java 7 itself. In particular, do not add:

- HTTP clients
- Framework annotations
- Logging façades
- Executors
- Persistence libraries
- JSON object mappers merely for model validation

JUnit is test-scoped and inherited from root dependency management.

## API rules

- All public signatures must use Java 7 types.
- Models must be immutable: final class, final fields, no setters, no mutable collections exposed.
- Builders validate at `build()` so invalid model instances cannot escape.
- Existing getters, builder methods, constructor meanings, enum constants, and validation behavior are compatibility commitments.
- Prefer additive changes. Removing or changing existing API behavior requires a major version.
- Do not expose Apache, Jackson, framework, or internal implementation types.
- Do not add Java 8 conveniences such as `Optional` overloads.

## Validation

Validation belongs in builders or constructors in this module, not in the HTTP layer. The HTTP layer may rely on `IncidentRequest` already being valid.

When adding a field, define:

1. Whether it is required.
2. Null behavior.
3. Blank-string behavior.
4. Range or length constraints.
5. Default behavior.
6. Whether a request value overrides a client default.

Add focused unit tests for every invalid boundary and default.

## Java compatibility

This module compiles to Java 7 bytecode through ECJ and runs Animal Sniffer during `verify`. Never disable or skip the Java 1.7 signature check to make a change compile.

## Verification

Run:

```shell
mvn -pl sdk-core -am clean verify
```

Also run the complete reactor before handoff because changes here affect `sdk-http` and every example:

```shell
mvn clean verify
```

