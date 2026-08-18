# `sdk-bundle` Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file governs the distributable library JAR.

## Purpose

This module produces `oppex-integration-sdk-${project.version}.jar`, the dependency-inclusive SDK library intended for direct application import. It contains `sdk-core`, `sdk-http`, Apache HttpClient, Jackson Core, and their required runtime dependencies.

The bundle is a library, not an application:

- Do not add a `Main-Class` manifest entry.
- Do not add example or smoke-test classes.
- Keep the supported top-level API limited to the six types documented at repository level.
- Keep framework dependencies out of the bundle.
- Keep signature files, multi-release module descriptors, and `CLAUDE.md` files out of the shaded JAR.
- Preserve service-provider resources when dependencies supply them.

The Shade execution replaces this module's initially empty JAR with the bundled library and writes a dependency-reduced POM under `target/`. This makes the main Maven artifact the fat JAR without publishing its already-embedded dependencies as transitives.

The JAR plugin must keep `forceCreation` enabled. Without it, a second Maven invocation that does not run `clean` can reuse the already-shaded output as Shade's input and report hundreds of duplicate classes.

## Verification

```shell
mvn -pl sdk-bundle -am clean verify
jar tf sdk-bundle/target/oppex-integration-sdk-1.0.0-SNAPSHOT.jar
```

Compile and run `.github/smoke/ExternalConsumer.java` with only the bundled JAR on the classpath. A passing test must not rely on separate `sdk-core`, `sdk-http`, Apache, or Jackson JARs.
