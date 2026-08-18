# GitHub Workflows Guide

`java-compatibility.yml` is the compatibility contract for Java 7, 8, 11, 17, 21, and 25.

The Maven reactor lives under `java/`. Keep `--file java/pom.xml` and all class, bundle, consumer, and upload paths rooted accordingly. GitHub discovers this workflow only because the YAML remains in the repository-root `.github/workflows/` directory.

Each matrix entry must independently:

1. Select the requested JDK.
2. Compile SDK and smoke sources.
3. Run SDK tests and Animal Sniffer.
4. Create the dependency-inclusive `oppex-integration-sdk` library JAR.
5. Confirm SDK bytecode major version 51.
6. Confirm the JAR contains no application `Main-Class`.
7. Compile a fresh external consumer with only that JAR on its classpath.
8. Run the external consumer with only that JAR and its compiled class.
9. Upload the library JAR for inspection.

Java 7 uses Maven 3.8.9 and Java-7-compatible plugin versions selected by the `java-7-build` Maven profile. Maven 3.9+ requires Java 8 and must not be used for that matrix entry.

Apache's Maven 3.8.9 `.sha512` archive file contains only the hexadecimal digest, while `sha512sum --check` requires a digest-plus-filename record. Keep the workflow's explicit digest validation and formatted standard-input record; passing the downloaded file directly to `sha512sum --check` fails before Maven is installed.

Use official GitHub actions. Do not reduce the matrix or mark legacy JDK failures optional without an explicit supported-version decision.
