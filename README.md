# Oppex Integration SDKs

This repository is the language-neutral home for Oppex integration client libraries.

## SDKs

- [`java/`](java/README.md): Java 7-compatible incident SDK and framework examples.
- [`python/`](python/README.md): Python 2.7 and Python 3-compatible incident SDK and framework examples.
- `javascript/`: reserved for a future JavaScript/TypeScript SDK.
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

## Build the Python library

```shell
cd python
PYTHONPATH=src python -m unittest discover -s tests -t .
./scripts/build-canonical.sh
```

The universal library is written to:

```text
python/dist/oppex_integration_sdk-<version>-py2.py3-none-any.whl
```

Building the canonical artifact requires a Python 2.7 interpreter, because that is the oldest
runtime the wheel claims to support. CI does this in a container; see
[`python/README.md`](python/README.md) for the alternatives when only Python 3 is available locally.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
