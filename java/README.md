# Oppex Java SDK

The Oppex Java SDK posts incidents to the Oppex REST API without exposing HTTP details to applications. It is framework-agnostic, thread-safe, and designed for one client instance per application.

## Requirements

- A Java Development Kit (JDK), version 7 or newer
- Apache Maven; use the version appropriate for the JDK in the table below
- Apache HttpClient is an internal implementation detail
- No dependency on Spring, Quarkus, Dropwizard, Micronaut, or Jakarta EE in the SDK artifacts

The SDK is compiled to Java 7-compatible bytecode regardless of which supported
JDK runs the build.

### Maven version by Java version

| JDK running Maven | Maven version | Build behavior |
| --- | --- | --- |
| Java 7 | Maven 3.8.9 | Required because Maven 3.9+ cannot run on Java 7. The `java-7-build` profile selects Java 7-compatible Maven plugins. |
| Java 8 | Maven 3.9.x; 3.9.16 recommended | Runs the standard build. |
| Java 11 | Maven 3.9.x; 3.9.16 recommended | Runs the standard build. |
| Java 17 | Maven 3.9.x; 3.9.16 recommended | Runs the standard build. |
| Java 21 | Maven 3.9.x; 3.9.16 recommended | The `modern-jdk-ecj` profile uses the Eclipse compiler to retain Java 7 source compatibility. |
| Java 25 | Maven 3.9.x; 3.9.16 recommended | The `modern-jdk-ecj` profile uses the Eclipse compiler to retain Java 7 source compatibility. |

CI installs Maven 3.8.9 explicitly for its Java 7 job. Its Java 8, 11, 17, 21,
and 25 jobs use the Maven 3.9.x installation supplied by the GitHub Actions
runner, so those jobs are not pinned to an exact patch release.

## First-time setup

For the simplest development setup, install JDK 17 and Maven 3.9.16. Download a
JDK from a distribution such as [Azul Zulu](https://www.azul.com/downloads/) (the
distribution used by CI), and install Maven using the
[official Maven installation guide](https://maven.apache.org/install.html) or
your operating system's package manager.

After installing the tools, clone and build the SDK:

```shell
git clone https://github.com/Oppex-AI/oppex-integration.git
cd oppex-integration/java

java -version
javac -version
mvn -version

mvn -pl sdk-bundle -am clean install
```

`mvn -version` must report the intended JDK as its Java runtime. The first Maven
build downloads the plugins and dependencies, runs the tests, and installs the
SDK artifacts in the local Maven repository. The dependency-inclusive JAR is
then available at:

```text
sdk-bundle/target/oppex-integration-sdk-1.0.0-SNAPSHOT.jar
```

If you must build while running Java 7, install Maven 3.8.9 from the
[Apache Maven archive](https://archive.apache.org/dist/maven/maven-3/3.8.9/binaries/)
and use the Java 7 command in [Build with a specific local Java version](#build-with-a-specific-local-java-version).

## Library artifact

Build the dependency-inclusive library with:

```shell
mvn -pl sdk-bundle -am clean verify
```

The distributable output is:

```text
sdk-bundle/target/oppex-integration-sdk-1.0.0-SNAPSHOT.jar
```

This JAR contains the SDK plus Apache HttpClient, Jackson Core, and their runtime dependencies. It has no `Main-Class`; add it to an application's classpath like any other library. After `mvn -pl sdk-bundle -am install`, Maven applications can depend on `dev.oppex:oppex-integration-sdk:1.0.0-SNAPSHOT`.

```xml
<dependency>
    <groupId>dev.oppex</groupId>
    <artifactId>oppex-integration-sdk</artifactId>
    <version>1.0.0-SNAPSHOT</version>
</dependency>
```

## Usage

```java
import dev.oppex.sdk.api.IncidentClient;
import dev.oppex.sdk.model.IncidentRequest;
import dev.oppex.sdk.model.IncidentResponse;
import dev.oppex.sdk.model.Severity;

IncidentClient client = IncidentClient.builder()
        .apiKey("your-api-key")
        .serviceKey("service-key")
        .tenant("tenant")
        .build();

try {
    IncidentRequest request = IncidentRequest.builder()
            .title("Deployment failed")
            .source("Deploy")
            .severity(Severity.HIGH)
            .component("deploy")
            .group("backend")
            .type("deployment")
            .details("{\"stacktrace\":\"...\"}")
            .build();

    IncidentResponse response = client.post(request);
    // Or use client.postAsync(request) for fire-and-forget delivery.
} finally {
    client.close();
}
```

`post` performs delivery and retries on the caller thread. `postAsync` uses two daemon workers and a bounded queue of 5,000 items. If that queue fills, the oldest queued incident is dropped so the newest incident can be accepted.

Delivery is best effort. The SDK retries temporary I/O failures and HTTP 429, 500, 502, 503, and 504 responses with delays of 500 ms, 1 s, 2 s, 4 s, and 8 s. It does not persist incidents or replay them after a process restart.

The framework-specific modules under `examples/` demonstrate lifecycle ownership; they are not SDK runtime dependencies.

## Java compatibility CI

The `Java compatibility` GitHub Actions workflow builds the canonical fat JAR
once with Java 7 and Maven 3.8.9, verifies its Java 7 bytecode, and records its
SHA-256 checksum. Every matrix job downloads that exact JAR, verifies the
checksum, compiles a fresh external consumer using only the JAR, and runs the
consumer on Java 7, 8, 11, 17, 21, and 25. The workflow uploads one short-lived
canonical JAR artifact rather than rebuilding it for each runtime.

After the repository is pushed to GitHub, trigger and follow it with GitHub CLI:

```shell
gh workflow run java-compatibility.yml
run_id=$(gh run list --workflow java-compatibility.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$run_id" --exit-status
```

Use `gh run view "$run_id" --log-failed` to inspect a failed matrix entry.

## Build

```shell
mvn -pl sdk-bundle -am clean verify
```

## Build with a specific local Java version

Select the JDK through `JAVA_HOME` and place that JDK first on `PATH`. For Java 8,
11, 17, 21, or 25, run the same build with the matching installed JDK:

```shell
JAVA_HOME=/absolute/path/to/jdk-17 \
PATH="/absolute/path/to/jdk-17/bin:$PATH" \
mvn -pl sdk-bundle -am clean verify
```

Repeat with the path to each JDK you want to verify. Confirm the selected tools
before a build with `java -version`, `javac -version`, and `mvn -version`.

Java 7 additionally requires Maven 3.8.9 because Maven 3.9 and newer require
Java 8. Use the Java-7-compatible Maven plugin profile explicitly:

```shell
JAVA_HOME=/absolute/path/to/jdk-7 \
PATH="/absolute/path/to/jdk-7/bin:$PATH" \
/absolute/path/to/apache-maven-3.8.9/bin/mvn \
  -Pjava-7-build \
  -pl sdk-bundle -am clean verify
```

Every successful local build creates the importable fat JAR at
`sdk-bundle/target/oppex-integration-sdk-1.0.0-SNAPSHOT.jar`. The release
pipeline intentionally builds that JAR only with Java 7. Its parallel matrix
jobs test the same downloaded bytes on every supported runtime.

## Publishing to Maven Central

Maven Central receives one canonical release for all supported Java runtimes:

```text
dev.oppex:oppex-integration-sdk:<version>
```

The SDK is Java 7 bytecode, so publishing separate `java7`, `java8`, `java17`,
and similar classifiers would duplicate the same library and would require
consumers to select a classifier manually. Instead, the release workflow builds
one canonical JAR on Java 7, records its checksum, and tests those exact bytes on
Java 7, 8, 11, 17, 21, and 25. It publishes only after every compatibility job
passes.

### One-time Maven Central setup

1. Create an account at the [Central Portal](https://central.sonatype.com/).
2. Register and verify the `dev.oppex` namespace. Because namespaces reverse a
   DNS domain, `dev.oppex` requires proof of control of `oppex.dev`. If Oppex
   cannot verify that domain, choose and migrate to a verifiable `groupId`
   before the first release; Maven Central coordinates are immutable.
3. Generate a Central Portal user token. The portal supplies a token username
   and token password. Store the username as `CENTRAL_USERNAME` and the token
   password as `CENTRAL_TOKEN`; do not use or store your normal login password.
4. Create a GPG signing key, publish its public key to a public key server, and
   store the ASCII-armored private key and passphrase in GitHub as
   `MAVEN_GPG_PRIVATE_KEY` and `MAVEN_GPG_PASSPHRASE`.
5. In the GitHub repository, open **Settings > Environments**, create an
   environment named `maven-central`, then add all four values under
   **Environment secrets**. Restrict deployments to protected `java-v*` tags
   and add required reviewers so publishing requires explicit approval.

The required environment secrets are:

| Secret | Value |
| --- | --- |
| `CENTRAL_USERNAME` | Username generated with the Central Portal user token |
| `CENTRAL_TOKEN` | Password/token generated with that Central Portal user token |
| `MAVEN_GPG_PRIVATE_KEY` | Complete ASCII-armored private signing key |
| `MAVEN_GPG_PASSPHRASE` | Passphrase for the private signing key |

The secrets must never be committed to this repository. The
`java-publish.yml` workflow uses them only in the protected publishing job.

### Publish a release

Create and push a stable Java release tag from the exact commit to publish:

```shell
git tag -a java-v1.0.0 -m "Java SDK 1.0.0"
git push origin java-v1.0.0
```

The workflow validates the tag, changes the reactor version from the development
`-SNAPSHOT` version to the tag version in the runner workspace, and runs the
full Java compatibility workflow. The publishing job downloads the tested JAR,
verifies its checksum, generates sources and Javadocs on JDK 17, restores the
canonical Java 7 JAR before signing, verifies byte-for-byte equality, signs all
Central files, and publishes through the Central Portal. A successful release
is available as:

```xml
<dependency>
    <groupId>dev.oppex</groupId>
    <artifactId>oppex-integration-sdk</artifactId>
    <version>1.0.0</version>
</dependency>
```

Do not reuse or move a published tag. Maven Central releases cannot be replaced
or deleted; publish a new version to correct a released artifact.

## License

This project is licensed under the [Apache License 2.0](../LICENSE).
