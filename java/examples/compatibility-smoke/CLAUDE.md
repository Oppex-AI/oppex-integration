# Compatibility Smoke Module Guide

This module contains a network-free compatibility program. The distributable fat library is produced by `sdk-bundle`, not by this example.

## Contract

- Compile with the same Java 7 source/target settings as the SDK.
- Depend on `oppex-integration-sdk` without expanding the supported public API.
- Run without network access or real credentials.
- Instantiate the supported request and client APIs so runtime linkage is exercised.
- Print `OPPEX_SDK_FAT_JAR_OK` only after every assertion and clean close succeeds.

GitHub Actions compiles and runs the repository-root `.github/smoke/java/ExternalConsumer.java` directly against the `java/sdk-bundle` JAR, so framework examples with newer Java requirements do not block Java 7 or Java 8 compatibility jobs.

Do not add Shade configuration or a `Main-Class` here. An example application JAR must never be confused with the distributable SDK library.
