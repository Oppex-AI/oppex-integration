# Oppex Java SDK

The Oppex Java SDK posts incidents to the Oppex REST API without exposing HTTP details to applications. It is framework-agnostic, thread-safe, and designed for one client instance per application.

## Requirements

- Java 7 or newer
- Apache HttpClient is an internal implementation detail
- No dependency on Spring, Quarkus, Dropwizard, Micronaut, or Jakarta EE in the SDK artifacts

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

The `Java compatibility` GitHub Actions workflow builds the fat library JAR, verifies Java 7 bytecode, compiles a fresh external consumer using only that JAR, and runs the consumer on Java 7, 8, 11, 17, 21, and 25. Each matrix entry uploads its library JAR as a short-lived workflow artifact.

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
