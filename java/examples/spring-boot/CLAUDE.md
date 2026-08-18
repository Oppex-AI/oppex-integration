# Spring Boot Example Guide

This folder demonstrates Spring-managed lifecycle without adding Spring behavior to the SDK.

- Keep `IncidentClient` as a singleton bean.
- Preserve `destroyMethod = "close"` or an equivalent deterministic shutdown hook.
- Read API key, service key, and tenant from Spring configuration.
- Do not add an SDK starter, auto-configuration metadata, classpath condition, or component scan to production artifacts.
- Do not reference internal SDK classes.
- Framework dependency versions remain local to this example POM.

The example currently uses Spring context APIs that work in Spring Boot applications; it is intentionally not packaged as an auto-configuration module.

