# Quarkus Example Guide

This folder demonstrates Quarkus/CDI lifecycle ownership without creating a Quarkus extension.

- Produce one application-scoped `IncidentClient`.
- Close it from `@PreDestroy`.
- Keep Jakarta/CDI dependencies provided or example-scoped.
- Do not introduce Quarkus build steps, deployment modules, reflection registration, native-image substitutions, or SDK annotations without an explicit new requirement.
- Do not reference internal SDK classes.
- Never embed credentials; use environment or configuration sources.

If native-image support is later requested, treat it as separate validated work rather than assuming this small lifecycle example proves native compatibility.

