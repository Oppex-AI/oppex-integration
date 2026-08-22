# Oppex Integration SDKs

This repository is the language-neutral home for Oppex integration client libraries.

## SDKs

- [`java/`](java/README.md): Java 7-compatible incident SDK and framework examples.
- [`node/`](node/README.md): Node.js incident SDK, published as two majors (`^1` for Node 8+, `^2` for Node 18+).
- `python/`: reserved for a future Python SDK.
- `golang/`: reserved for a future Go SDK.

Each language directory owns its build system, dependencies, tests, examples, release metadata, and detailed engineering guide. Repository-wide GitHub Actions remain under `.github/workflows/` because GitHub only discovers workflows from that root location.

## Build the Java library

```shell
cd java
mvn -pl sdk-bundle -am clean verify
```

The dependency-inclusive library is written to:

```text
java/sdk-bundle/target/oppex-integration-sdk-1.0.0-SNAPSHOT.jar
```

## License

This project is licensed under the [Apache License 2.0](LICENSE).
