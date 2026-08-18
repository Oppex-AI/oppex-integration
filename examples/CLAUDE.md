# Framework Examples Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first.

## Purpose

These modules demonstrate how applications own one `IncidentClient` and connect its `close()` method to framework shutdown. They are examples only; they are not production framework integrations, auto-configurations, extensions, or starters.

## Boundaries

- Framework dependencies remain in the individual example POM.
- No example dependency may be promoted into `sdk-core` or `sdk-http`.
- Examples use only the six supported SDK types and never `dev.oppex.sdk.internal`.
- Use dummy values or environment/configuration placeholders; never commit real credentials.
- Keep examples small enough to show lifecycle ownership clearly.
- Examples do not need to post to the real service during build or tests.
- Framework-specific Java baselines do not change the SDK's Java 7 baseline.

## Module intent

- `compatibility-smoke`: network-free source compatibility example; fat-JAR production belongs to `sdk-bundle`.
- `plain-java`: direct create/use/finally-close ownership.
- `spring-boot`: singleton bean and destroy callback, without SDK auto-configuration.
- `quarkus`: application-scoped CDI producer and pre-destroy cleanup, without an extension.
- `dropwizard`: `Managed` lifecycle wrapper.

Register new example modules in this directory's POM and verify the complete reactor with `mvn clean verify`.
