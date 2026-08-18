# Plain Java Example Guide

This example must remain Java 7-compatible and framework-free.

- Read configuration from obvious placeholders or environment variables.
- Create one client.
- Demonstrate either synchronous or asynchronous posting with supported API types.
- Always show deterministic close in `finally` because Java 7 cannot use the Java 9 effectively-final try-with-resources form.
- Do not add an executor, HTTP client, or retry loop; the SDK owns those concerns.
- Do not make a real network call as part of the Maven build.

This is the baseline example against which framework examples should remain conceptually consistent.

