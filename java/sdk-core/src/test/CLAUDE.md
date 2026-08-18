# `sdk-core` Test Guide

Tests here protect immutable model and exception contracts.

- Use JUnit 4 and Java 7 syntax.
- Cover required, null, blank, range, maximum-length, default, and enum-mapping behavior.
- Assert behavior through the supported API rather than reflection into private fields.
- Keep tests deterministic and free of network, filesystem, clock-bound sleeps, and framework dependencies.
- When adding a model field, add both a successful construction assertion and every relevant invalid boundary.
- Do not weaken validation tests merely to accommodate invalid new inputs.

Run `mvn -pl sdk-core -am test` while iterating and the full `mvn clean verify` before handoff.

