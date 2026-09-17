# Oppex Integration SDKs

This repository is the language-neutral home for Oppex integration client libraries.

All of them post to the same endpoint, with the same payload, severity scale,
retry policy and lifecycle guarantees:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

## SDKs

| Language | Directory | Published to | Supported runtimes |
| --- | --- | --- | --- |
| Java | [`java/`](java/README.md) | Maven Central | Java 7 and newer |
| Python | [`python/`](python/README.md) | PyPI | CPython 2.7 and 3.x |
| Node.js | [`node/`](node/README.md) | npm (two packages) | Node 8+ (`^1`), Node 18+ (`^2`) |
| Go | [`golang/`](golang/README.md) | the Go module proxy | current stable Go |
| Rust | [`rust/`](rust/README.md) | crates.io | current stable Rust |
| Ruby | [`ruby/`](ruby/README.md) | RubyGems | current stable Ruby |
| .NET | [`dotnet/`](dotnet/README.md) | NuGet | current stable .NET |
| C and C++ | [`cpp/`](cpp/README.md) | GitHub Release artifacts | current toolchains |

The first three carry deliberate, expensive support for runtimes far older than
their build tooling prefers, for reasons their own guides explain. The rest
support the current stable release of their language only.

Each language directory owns its build system, dependencies, tests, examples,
release metadata, and detailed engineering guide. Repository-wide GitHub Actions
remain under `.github/workflows/` because GitHub only discovers workflows from
that root location.

## Build each library

### Java

```shell
cd java
mvn -pl sdk-bundle -am clean verify
```

The dependency-inclusive library is written to
`java/sdk-bundle/target/oppex-integration-sdk-1.0.0-SNAPSHOT.jar`.

### Python

```shell
cd python
PYTHONPATH=src python -m unittest discover -s tests -t .
./scripts/build-canonical.sh
```

The universal library is written to
`python/dist/oppex_integration_sdk-<version>-py2.py3-none-any.whl`.

Building the canonical artifact requires a Python 2.7 interpreter, because that
is the oldest runtime the wheel claims to support. CI does this in a container;
see [`python/README.md`](python/README.md) for the alternatives when only Python
3 is available locally.

### Node.js

```shell
cd node
./scripts/build-all.sh
```

### Go

```shell
cd golang
go build ./... && go vet ./... && go test -race ./...
```

### Rust

```shell
cd rust
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

### Ruby

```shell
cd ruby
bundle install && bundle exec rake
```

### .NET

```shell
cd dotnet
dotnet test Oppex.Integration.Sdk.slnx -c Release
```

### C and C++

```shell
cd cpp
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
```

Requires libcurl and a C++20 compiler.

## Releases

Every SDK releases independently, from a language-qualified tag:

```text
java-vX.Y.Z    python-vX.Y.Z    rust-vX.Y.Z
ruby-vX.Y.Z    dotnet-vX.Y.Z    cpp-vX.Y.Z
```

Go is the exception: a Go module in a subdirectory is only resolvable from a tag
carrying that directory prefix, so the Go SDK releases as `golang/vX.Y.Z` and has
no publish job at all — the module proxy serves it straight from the repository.

A tag never triggers another language's release.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
