# `sdk-bundle` Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file governs the distributable library JAR.

## Purpose

This module produces `oppex-integration-sdk-${project.version}.jar`, the dependency-inclusive SDK library intended for direct application import. It contains `sdk-core`, `sdk-http`, Apache HttpClient, Jackson Core, and their required runtime dependencies, with every embedded third-party package relocated under `dev.oppex.sdk.shaded`.

The bundle is a library, not an application:

- Do not add a `Main-Class` manifest entry.
- Do not add example or smoke-test classes.
- Keep the supported top-level API limited to the six types documented at repository level.
- Keep framework dependencies out of the bundle.
- Keep signature files, multi-release module descriptors, and `CLAUDE.md` files out of the shaded JAR.
- Preserve service-provider resources when dependencies supply them.
- Relocate every embedded third-party package. Never publish this JAR with a dependency under its original package name.

The Shade execution replaces this module's initially empty JAR with the bundled library and writes a dependency-reduced POM under `target/`. This makes the main Maven artifact the fat JAR without publishing its already-embedded dependencies as transitives.

The JAR plugin must keep `forceCreation` enabled. Without it, a second Maven invocation that does not run `clean` can reuse the already-shaded output as Shade's input and report hundreds of duplicate classes.

## Relocation

A fat JAR reaches an application as a direct dependency, so its entries precede that application's transitive dependencies on the classpath. When this bundle shipped `com.fasterxml.jackson.core` unrelocated, its Jackson Core 2.12.7 shadowed the 2.19.x version a Spring Boot application had managed, and `jackson-databind` then failed against the older streaming classes across the whole application, not merely inside the SDK. Maven cannot mediate this: the classes are bytes inside our artifact and never appear in the dependency graph.

Every embedded package is therefore relocated:

| Original | Shaded |
| --- | --- |
| `com.fasterxml.jackson` | `dev.oppex.sdk.shaded.com.fasterxml.jackson` |
| `org.apache.http` | `dev.oppex.sdk.shaded.org.apache.http` |
| `org.apache.commons.codec` | `dev.oppex.sdk.shaded.org.apache.commons.codec` |
| `org.apache.commons.logging` | `dev.oppex.sdk.shaded.org.apache.commons.logging` |

Relocation is only available because Jackson and HttpClient are confined to `JsonCodec` and `HttpExecutor` and never appear in a supported public signature. A change that exposes either library publicly removes this option and must be rejected on that ground alone.

Three consequences are accepted deliberately:

- Relocating `commons-logging` rewrites the discovery strings inside `LogFactory`, so HttpClient's internal logging falls back to JUL instead of the application's SLF4J or Log4j binding. An application's `org.apache.http.wire` configuration has no effect on the bundled client. This is documented in `java/README.md` rather than worked around, because routing internal transport logs into application logging would require the SDK to take a logging dependency it deliberately does not have.
- Shade cannot relocate a resource path, so HttpClient's `mozilla/public-suffix-list.txt` stays at JAR root. Keeping it is correct: excluding it makes `PublicSuffixMatcherLoader` return no matcher and degrades cookie-domain validation. An application that also ships HttpClient simply has the same file twice and the first one on the classpath wins.
- `minimizeJar` stays off. HttpClient resolves cookie specs and connection socket factories reflectively, and minimization would prune classes no smoke test loads.

Relocation renames classes in the constant pool. It does not recompile, so class-file versions are unchanged and the Java 7 compatibility floor is unaffected. On Java 9 and later it is a strict improvement: the `dev.oppex.sdk` automatic module no longer exports `com.fasterxml.jackson.core`, which removes a split-package clash with the real `com.fasterxml.jackson.core` module.

## Verification

```shell
mvn -pl sdk-bundle -am clean verify
jar tf sdk-bundle/target/oppex-integration-sdk-1.0.0-SNAPSHOT.jar
```

Compile and run the repository-root `.github/smoke/java/ExternalConsumer.java` with only the bundled JAR on the classpath. A passing test must not rely on separate `sdk-core`, `sdk-http`, Apache, or Jackson JARs.

`ExternalConsumer` and the `compatibility-smoke` example both assert that each bundled dependency loads under its shaded name and does **not** load under its original name. Those assertions are the relocation regression test; keep them in step with the relocation table above. The `Java compatibility` workflow additionally fails on any JAR entry outside `dev/oppex/`, `META-INF/`, and `mozilla/public-suffix-list.txt`, and on any `META-INF/services` file still named for an unrelocated package.

```shell
jar tf sdk-bundle/target/oppex-integration-sdk-1.0.0-SNAPSHOT.jar \
  | grep --invert-match --extended-regexp '/$|^(dev/oppex/|META-INF/|mozilla/public-suffix-list\.txt$)'
```
