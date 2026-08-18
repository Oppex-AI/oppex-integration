# Oppex Java SDK Engineering Guide

Read the repository-level [`../CLAUDE.md`](../CLAUDE.md) first. This file is the durable engineering context for the Java SDK directory. It records why the Java project is structured as it is, which decisions are intentional, and how future contributors and coding agents must evolve it without accidentally breaking Java compatibility, API stability, delivery semantics, or framework independence.

The Java SDK was created as a greenfield Maven project and later moved intact under `java/` when the repository became a multi-language SDK monorepo. There was no existing application code to preserve. The structure therefore reflects library-design concerns rather than application conventions.

## 1. Mission

The SDK gives Java applications a minimal API for posting incidents to:

```text
POST https://api.oppex.ai/api/v1/incident/post
```

Users should not need to understand Apache HttpClient, connection pooling, JSON serialization, retry classification, asynchronous queues, or shutdown coordination.

The expected client setup is:

```java
IncidentClient client = IncidentClient.builder()
        .apiKey("api-key")
        .serviceKey("service-key")
        .tenant("tenant")
        .build();
```

Create one client per application, reuse it concurrently, and close it during application shutdown.

## 2. Non-negotiable constraints

Changes must preserve all of these constraints unless a deliberate new major-version decision is documented first:

- Production code must remain compatible with Java 7.
- Production classes must remain Java class-file version 51.
- Public signatures must not expose Java 8+ APIs such as `Optional`, streams, `CompletableFuture`, lambdas, records, modules, or sealed types.
- The SDK must not depend on Spring, Quarkus, Dropwizard, Micronaut, Jakarta EE, or any other application framework.
- Apache HttpClient 4.x is an internal implementation detail and must never appear in supported public signatures.
- The delivery model is best effort. There is no disk persistence, embedded database, durable queue, or replay after JVM restart.
- One client owns one shared `CloseableHttpClient`, one pooling connection manager, and its asynchronous worker resources.
- Synchronous calls run and retry on the caller thread.
- Asynchronous calls are fire-and-forget and use the bounded SDK-owned executor.
- V1 intentionally has no advanced public transport configuration.
- Internal metrics are not a supported public API.
- Do not introduce a generic transport abstraction, messaging system, framework extension, or automatic framework configuration.

Prefer KISS and YAGNI. New abstractions need a concrete present use, not a speculative future use.

## 3. Important design decisions

### 3.1 `IncidentClient` is a final façade, not an interface

The initial API goals required both of the following:

```java
public interface IncidentClient extends Closeable
```

and:

```java
IncidentClient.builder()
```

Those requirements conflict on Java 7 because static interface methods were introduced in Java 8. The chosen resolution is:

```java
public final class IncidentClient implements Closeable
```

This preserves Java 7 support and the preferred builder syntax. The trade-off is intentional: applications cannot implement or directly mock `IncidentClient` as an interface. Do not revert it to an interface unless Java 7 support or the construction syntax is explicitly changed as part of a breaking release.

### 3.2 Supported public API

The supported top-level API consists of exactly these types:

- `dev.oppex.sdk.api.IncidentClient`
- `dev.oppex.sdk.builder.IncidentClientBuilder`
- `dev.oppex.sdk.model.IncidentRequest`
- `dev.oppex.sdk.model.IncidentResponse`
- `dev.oppex.sdk.exception.IncidentException`
- `dev.oppex.sdk.model.Severity`

`IncidentRequest.Builder` is a nested builder belonging to `IncidentRequest`.

Classes below `dev.oppex.sdk.internal` are implementation details even where Java package boundaries require a `public` modifier for cross-package construction or invocation. They have no compatibility guarantee and must never be referenced by examples or application-facing documentation. Java 7 has no module export mechanism, so package naming and documentation define this boundary.

Adding another supported public top-level type requires a strong use case and an explicit API-compatibility review.

### 3.3 Module boundary

The build uses two implementation artifacts and one distribution artifact:

- `sdk-core` contains immutable API models and the checked SDK exception. It has no HTTP or framework dependency.
- `sdk-http` depends on `sdk-core` and contains the client façade, client builder, HTTP implementation, retry policy, async delivery, internal metrics, and JSON codec.
- `oppex-integration-sdk`, built from `sdk-bundle`, is the dependency-inclusive, non-executable library distributed to applications.

Applications import `oppex-integration-sdk` when they need a single JAR. The bundle embeds `sdk-core`, `sdk-http`, Apache HttpClient, Jackson Core, and required transitives while preserving the same six-type supported API.

This direction avoids a circular dependency. Putting `IncidentClient` in `sdk-core` while putting its only implementation in `sdk-http` would force either a core-to-HTTP dependency cycle, reflection/service loading, or an unnecessary transport-provider abstraction. None was justified for V1.

### 3.4 Corrected root artifact name

The original module description contained the typo `oppex-inetgration-sdk`. The distributable artifact is intentionally named `oppex-integration-sdk`. The reactor parent uses `oppex-integration-sdk-parent` so the parent POM and library JAR have unique Maven coordinates.

### 3.5 Severity convention

The adjacent Oppex backend uses a numeric severity scale from 1 through 5, with 1 lowest and 5 highest. The SDK maps it as follows:

| Numeric value | Enum |
| --- | --- |
| 1 | `LOWEST` |
| 2 | `LOW` |
| 3 | `MEDIUM` |
| 4 | `HIGH` |
| 5 | `CRITICAL` |

Both `severity(Severity)` and `severity(int)` exist. Numeric conversion is validated during `IncidentRequest.Builder.build()`.

### 3.6 Dependency choices

Production runtime dependencies are intentionally narrow:

- Apache HttpClient `4.5.14` for Java 7-compatible pooled HTTP.
- Jackson Core `2.12.7` for Java 7-compatible streaming JSON generation and parsing.

Jackson Databind is deliberately not used. The API response is small and known, so streaming parsing avoids a larger object-mapping surface and databind-specific security/maintenance concerns.

Apache automatic retries are disabled. All retry decisions belong to `RetryExecutor`, ensuring one clear policy and accurate retry metrics.

Framework libraries appear only in their respective example modules.

## 4. Directory layout

```text
java/
├── pom.xml
├── README.md
├── CLAUDE.md
├── sdk-core/
│   ├── pom.xml
│   └── src/
│       ├── main/java/dev/oppex/sdk/
│       │   ├── exception/IncidentException.java
│       │   └── model/
│       │       ├── IncidentRequest.java
│       │       ├── IncidentResponse.java
│       │       └── Severity.java
│       └── test/java/dev/oppex/sdk/model/
├── sdk-http/
│   ├── pom.xml
│   └── src/
│       ├── main/java/dev/oppex/sdk/
│       │   ├── api/IncidentClient.java
│       │   ├── builder/IncidentClientBuilder.java
│       │   └── internal/
│       │       ├── async/
│       │       ├── http/
│       │       ├── metrics/
│       │       └── retry/
│       └── test/java/dev/oppex/sdk/
├── sdk-bundle/
│   ├── CLAUDE.md
│   └── pom.xml
└── examples/
    ├── pom.xml
    ├── compatibility-smoke/
    ├── plain-java/
    ├── spring-boot/
    ├── quarkus/
    └── dropwizard/
```

Generated `target/` directories are ignored and must not be committed. IDE metadata is also ignored. Dependency versions shared by Java production modules are centralized in `java/pom.xml`.

## 5. Module responsibilities

### 5.1 `sdk-core`

`sdk-core` owns value semantics and public validation behavior.

#### `IncidentRequest`

- Immutable after construction.
- No setters.
- Constructed only with its nested builder.
- Strings are safe to share because `String` is immutable.
- Client-level `serviceKey` and `tenant` can be overridden on an individual request.
- `srcTimestamp` defaults to `System.currentTimeMillis()` at build time.
- `priority` defaults to 1.

Validation performed by `build()`:

| Field | Rule |
| --- | --- |
| `title` | Required and non-blank |
| `source` | Required, non-blank, maximum 255 characters |
| `severity` | Required and between 1 and 5 |
| `priority` | Between 1 and 5 |
| `srcTimestamp` | Greater than zero when supplied |
| `serviceKey` | Optional request override; non-blank when supplied |
| `tenant` | Optional request override; non-blank when supplied |
| `component` | Optional; non-blank when supplied |
| `group` | Optional; non-blank when supplied |
| `type` | Optional; non-blank when supplied |
| `details` | Optional JSON text; non-blank when supplied |

The request builder must continue to reject invalid objects before they reach the transport layer.

#### `IncidentResponse`

Represents the Oppex response fields used by callers:

- `successful`
- `code`
- `message`
- `incidentId`, parsed from the response `data` field

#### `IncidentException`

Synchronous transport failures use this checked exception. It carries:

- `statusCode`, or `-1` when no HTTP response was received
- `retryable`, used internally by the retry policy and available for diagnostics

### 5.2 `sdk-http`

`sdk-http` owns all delivery behavior.

#### `IncidentClientBuilder`

The minimal required client configuration is:

- `apiKey`
- `serviceKey`
- `tenant`

All three are validated as non-null and non-blank during `build()`. Do not add timeout, queue, executor, proxy, serializer, connection-pool, or retry knobs to the V1 public builder without an explicit product/API decision.

#### `IncidentClient`

`IncidentClient` is final, reusable, and thread-safe. Its important invariants are:

- Client defaults are final fields.
- The HTTP client and executor are created once per façade instance.
- A fair `ReentrantReadWriteLock` coordinates synchronous delivery with close.
- Synchronous delivery holds the lifecycle read lock so HTTP resources cannot be closed mid-call.
- Close holds the lifecycle write lock, transitions the atomic closed state once, drains/stops async work, and then closes HTTP resources.
- Async submission does not take the lifecycle lock. It uses atomic closed checks and the dispatcher's own close state so a caller does not wait behind a potentially long close operation.
- Calling `close()` repeatedly is safe.
- Calling synchronous `post()` after close produces `IncidentException`.
- Calling `postAsync()` after close produces `IllegalStateException`.
- Passing a null request produces `IllegalArgumentException`.

The public three-string constructor exists for straightforward construction, but documentation should continue to prefer `IncidentClient.builder()` for readability and future source compatibility.

### 5.3 `sdk-bundle`

`sdk-bundle` produces the main `dev.oppex:oppex-integration-sdk` fat library artifact. It has no source code and adds no public API. Maven Shade replaces its empty module JAR with a dependency-inclusive JAR and generates a dependency-reduced POM under `target/`.

The bundle's JAR plugin forces recreation of the empty input JAR on every Maven invocation. This prevents an existing shaded output from becoming Shade input when `package`, `verify`, or `install` is run again without `clean`.

The bundle deliberately has no `Main-Class`. It must be consumed on an application classpath, not launched with `java -jar`. Signature files, `CLAUDE.md` files, and multi-release `module-info.class` entries are excluded; service-provider resources are merged.

## 6. HTTP contract

`HttpExecutor` has one responsibility: serialize, create and execute the POST, parse the response, and classify HTTP failures.

Request details:

- Method: `POST`
- Endpoint: `https://api.oppex.ai/api/v1/incident/post`
- `Content-Type: application/json`
- `Accept: application/json`
- `X-API-KEY: <configured API key>`

Wire fields:

```json
{
  "serviceKey": "service-key",
  "title": "Incident title",
  "source": "Deploy",
  "severity": 2,
  "priority": 1,
  "srcTimestamp": 1787036524808,
  "tenant": "tenant",
  "component": "deploy",
  "group": "backend",
  "type": "deployment",
  "detailsJSON": "{\"stacktrace\":\"...\"}"
}
```

Optional fields are omitted when absent. Request-level `serviceKey` and `tenant` take precedence over client defaults.

The pool is configured with:

- Maximum total connections: 20
- Maximum connections per route: 20
- Connect timeout: 3 seconds
- Socket timeout: 5 seconds
- Connection-request timeout: 3 seconds

These are internal V1 opinions, not public configuration.

HTTP 2xx responses are parsed into `IncidentResponse`. A 2xx response whose JSON says `success: false` is still returned as a response; HTTP transport status controls exception behavior. Empty 2xx responses produce a minimal successful response using the HTTP status.

Error response bodies are parsed only to enrich the exception message. Malformed error bodies do not obscure the status code. Response-close failures must not mask an already determined HTTP result.

Never log the API key or full incident body.

## 7. Retry policy

There are five retries after the initial attempt, for a maximum of six attempts.

Backoff delays are exact and intentionally have no jitter in V1:

1. 500 ms
2. 1 second
3. 2 seconds
4. 4 seconds
5. 8 seconds

Retry all `IOException` transport failures, including timeouts, unknown hosts, refused connections, and connection resets, unless the current thread is already interrupted.

Retry these HTTP statuses:

- 429
- 500
- 502
- 503
- 504

Do not retry these statuses:

- 400
- 401
- 403
- 404
- 409
- 422

All other HTTP statuses are non-retryable unless the policy is deliberately updated and covered by tests.

An interrupt during backoff restores the thread interrupt flag and stops retrying. Never swallow interruption.

## 8. Synchronous delivery flow

```text
Application thread
  -> IncidentClient.post
  -> RetryExecutor
  -> HttpExecutor
  -> shared Apache CloseableHttpClient
  -> Oppex API
```

There is no executor or queue in this path. The caller experiences request time and backoff delays directly. Metrics are updated around the complete logical delivery, not separately for each attempt.

## 9. Asynchronous delivery flow

```text
Application thread
  -> IncidentClient.postAsync
  -> AsyncDispatcher
  -> ThreadPoolExecutor
  -> RetryExecutor
  -> HttpExecutor
  -> shared Apache CloseableHttpClient
  -> Oppex API
```

The production executor configuration is fixed:

- Core threads: 2
- Maximum threads: 2
- Keep-alive: 0 ms
- Queue: `ArrayBlockingQueue<Runnable>`
- Queue capacity: 5,000
- Worker threads: daemon threads named `oppex-incident-worker-N`
- Rejection policy: custom drop-oldest handler

Do not replace this with `Executors.newFixedThreadPool()`. That factory hides the queue configuration and does not express the required overflow behavior.

### Queue overflow

When the queue is full:

1. Remove the oldest queued task.
2. Mark it dropped and decrement the queued gauge.
3. Offer the newest task.
4. If the executor has shut down or the offer loses a race, mark the newest task dropped too.

`TrackedTask` uses an atomic terminal transition so running and dropping cannot decrement metrics twice.

The custom handler is required for metric and logging hooks; do not replace it with `DiscardOldestPolicy`.

## 10. Internal metrics and logging

`InternalMetrics` maintains:

- `queued`: current number accepted but not yet started or dropped
- `processed`: completed logical sync or async deliveries
- `successful`: logical deliveries that returned a response
- `failed`: logical deliveries that exhausted retry or failed permanently
- `retried`: retry delays entered
- `dropped`: asynchronous tasks discarded before execution

These counters are intentionally not reachable from `IncidentClient` in V1. If metrics are exposed later, define a stable snapshot API rather than leaking mutable atomics or executor internals.

Drops use `java.util.logging` with rate limiting. The logger accumulates drops and emits a summary when a drop crosses the one-minute interval, for example:

```text
Dropped 250 incidents in the last minute.
```

Do not emit one warning per dropped incident. Asynchronous permanent delivery failures are logged only at `FINE` to avoid flooding host applications.

## 11. Shutdown behavior

`IncidentClient.close()` performs these actions in order:

1. Prevent duplicate close work with the atomic closed state.
2. Reject new asynchronous submissions.
3. Call `shutdown()` so already queued work can drain.
4. Wait up to 10 seconds for async termination.
5. If needed, call `shutdownNow()` and account for queued tasks returned by the executor.
6. Close the shared Apache client.
7. Shut down the pooling connection manager.

Daemon workers ensure forgotten close calls do not keep the JVM alive, but applications must still close the client to drain work and release sockets deterministically.

Do not close the HTTP resources before the asynchronous drain attempt; queued work shares those resources.

## 12. Java 7 build strategy

The build selects a compiler and plugin set according to the JDK running Maven:

- Java 7 uses Maven 3.8.9, Java-7-compatible Maven plugin versions, and its native `javac`.
- Java 8 through 17 use current Maven 3.x plugins and the JDK's native `javac`, which still accepts source/target 7.
- Java 18 and newer activate the `modern-jdk-ecj` profile and use Eclipse ECJ because these JDKs no longer accept source/target 7 with `javac`.

The `java-7-build` profile is activated automatically on Java 7 and selects compiler, resources, Surefire, JAR, Shade, and Animal Sniffer plugin releases whose own bytecode runs on Java 7. Maven 3.9+ itself requires Java 8, so GitHub Actions installs Maven 3.8.9 for the Java 7 matrix entry.

The build also runs Animal Sniffer against:

```text
org.codehaus.mojo.signature:java17:1.0
```

Despite its artifact name, `java17` means Java 1.7, not Java 17. This check prevents production code from compiling against post-Java-7 JDK APIs merely because the build happens to run on a newer JDK.

Both mechanisms matter:

- `javac` or ECJ source/target 1.7 enforces Java 7 language syntax and class-file version 51.
- Animal Sniffer enforces Java 7 JDK API usage.

Do not remove either check. A successful build on JDK 17, 21, or 25 alone does not prove Java 7 runtime compatibility.

The production dependencies currently contain Java 6-compatible bytecode, so they are safe for Java 7.

## 13. Framework examples

Examples are separate Maven modules so framework dependencies never contaminate SDK artifacts.

- `examples/plain-java` demonstrates direct ownership and a `finally` close.
- `examples/compatibility-smoke` is a network-free source compatibility example; it does not create the SDK distribution.
- `examples/spring-boot` demonstrates a singleton bean with `destroyMethod = "close"`; it is an example, not SDK auto-configuration.
- `examples/quarkus` demonstrates an application-scoped CDI producer and `@PreDestroy`; it is not a Quarkus extension.
- `examples/dropwizard` demonstrates Dropwizard's `Managed` lifecycle.

Examples may use the minimum Java version required by their framework. That does not change the Java 7 contract of `sdk-core` or `sdk-http`.

Do not move framework annotations or dependencies into production modules.

### GitHub compatibility matrix

The repository-root `.github/workflows/java-compatibility.yml` independently builds and tests this directory on Java 7, 8, 11, 17, 21, and 25. Each entry compiles and runs `.github/smoke/java/ExternalConsumer.java` with only the generated `java/sdk-bundle` fat library and the consumer class on its classpath. This catches missing shaded dependencies, runtime linkage failures, and source-level consumer compatibility failures.

The smoke program is network-free. It creates and closes a client, validates model behavior, and loads representative Apache and Jackson classes without posting to Oppex.

The fat JAR is the application-facing distribution artifact. It contains no example classes and no application `Main-Class`. `sdk-core` and `sdk-http` remain separate implementation modules for development and testing.

Once the repository has a GitHub remote, use:

```shell
gh workflow run java-compatibility.yml
run_id=$(gh run list --workflow java-compatibility.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$run_id" --exit-status
gh run view "$run_id" --log-failed
```

## 14. Tests and verification

The test suite was written alongside the implementation. At initial completion it contained 25 tests.

Coverage responsibilities:

| Test area | Primary test |
| --- | --- |
| Severity mapping | `SeverityTest` |
| Request immutability/defaults/validation | `IncidentRequestTest` |
| Client configuration validation | `IncidentClientBuilderTest` |
| I/O and HTTP retry behavior | `RetryExecutorTest` |
| Retry limit and backoff order | `RetryExecutorTest` |
| Queue capacity and drop-oldest behavior | `AsyncDispatcherTest` |
| Rejection after shutdown | `AsyncDispatcherTest` |
| Rate-limited drop summary | `RateLimitedDropLoggerTest` |
| Wire field names and escaping | `JsonCodecTest` |
| Client-default/request-override precedence | `JsonCodecTest` |
| Response parsing | `JsonCodecTest` |
| Real local HTTP POST, header, and body | `HttpExecutorTest` |
| Retryable vs non-retryable HTTP classification | `HttpExecutorTest` |

`HttpExecutorTest` uses the JDK's local `HttpServer`; tests must not call the real Oppex service.

Run the complete verification before handing off changes:

```shell
mvn clean verify
```

Useful focused commands:

```shell
mvn -pl sdk-core -am test
mvn -pl sdk-http -am test
mvn -pl sdk-core,sdk-http -am verify
mvn -pl sdk-bundle -am clean verify
```

To inspect the bytecode version:

```shell
file sdk-http/target/classes/dev/oppex/sdk/api/IncidentClient.class
```

The expected output includes `version 51.0 (Java 1.7)`.

## 15. How to manage changes

### Adding a request field

1. Confirm the Oppex endpoint wire name and type.
2. Add a final field and getter to `IncidentRequest`.
3. Add builder state and a fluent builder method using Java 7-compatible types.
4. Define null, blank, range, length, and default behavior explicitly.
5. Serialize it in `JsonCodec`, omitting it only if the API defines it as optional.
6. Add builder and serialization tests.
7. Ensure the change is source- and binary-compatible for existing callers.

### Changing retry behavior

1. Update `RetryExecutor` or HTTP classification, not Apache automatic retry settings.
2. Preserve interrupt handling.
3. Add deterministic tests using the injectable test sleeper; unit tests must not sleep in real time.
4. Re-evaluate worst-case close and caller latency.
5. Update this file and `README.md` when user-visible behavior changes.

### Changing async behavior

1. Preserve non-blocking queue operations on the submission path.
2. Preserve the fixed two-worker pool unless a new product decision says otherwise.
3. Preserve bounded memory and drop-oldest semantics.
4. Check queued/dropped accounting under races with close and worker startup.
5. Keep workers daemonized and SDK-owned.

### Adding a dependency

Before adding a production dependency, verify:

- It supports Java 7 at runtime.
- Its transitive dependency tree supports Java 7.
- It is framework-neutral.
- It does not leak types into public signatures.
- The behavior cannot be implemented simply with existing dependencies.
- Its version is centralized in the root POM when shared.

Run Animal Sniffer and inspect representative dependency bytecode where compatibility is uncertain.

### Adding a framework example

Add it below `examples/`, register it in `examples/pom.xml`, keep its dependencies local to its POM, and demonstrate lifecycle ownership rather than introducing SDK-side integration code.

### Adding public API

Treat every new public method, constructor, enum value, and supported class as a long-term compatibility commitment. Prefer adding methods to builders and immutable response data rather than adding general-purpose extension points.

Never remove or change the meaning of existing public methods in a minor release.

## 16. Source and artifact hygiene

- Keep production and test code in the conventional Maven directories.
- Do not commit `target/`, IDE files, local Maven repositories, credentials, API keys, or captured incident bodies.
- Do not place secrets in tests; use obvious dummy values such as `secret` or `api-key`.
- Keep generated files out of source directories.
- Package-level `CLAUDE.md` files are repository guidance, not runtime resources. The root JAR configuration excludes them from published artifacts even if the compiler copies them into `target/classes`.
- Do not add mutable static state. Immutable constants and conventional loggers are acceptable; runtime counters and resources belong to client instances.
- Internal constructors may be widened only when package boundaries make it necessary; this does not make the class supported API.
- Prefer constructor injection for internal collaborators and package-private test seams over global hooks.
- Do not make the endpoint configurable in the public V1 API solely to simplify testing; test internal HTTP components against a local server.

## 17. Known V1 limitations and deliberate omissions

- No durable delivery or replay.
- No delivery receipt for `postAsync()`.
- No public metrics snapshot.
- No custom executor.
- No custom retry policy.
- No custom endpoint, proxy, TLS, timeout, pool, serializer, or queue configuration.
- No batching.
- No cancellation API.
- No framework auto-configuration or extensions.
- No transport abstraction.
- No Maven Central deployment profile yet.

The repository has Maven coordinates and artifact structure, but final Maven Central publication metadata is intentionally incomplete. License selection, SCM coordinates, developer/organization metadata, signing configuration, and publication credentials require project-owner and legal decisions and must not be invented by a coding agent.

## 18. Final change checklist

Before completing any SDK change, verify:

- [ ] The supported API remains Java 7-compatible.
- [ ] No framework types entered `sdk-core` or `sdk-http`.
- [ ] No Apache HttpClient type entered a supported public signature.
- [ ] Requests remain immutable and invalid states remain unbuildable.
- [ ] Sync calls do not use an executor.
- [ ] Async submission remains bounded and non-blocking.
- [ ] Retryable and non-retryable failures remain explicitly tested.
- [ ] Interrupts are restored, not swallowed.
- [ ] Close remains idempotent and bounded for queued async work.
- [ ] Logs do not expose secrets or flood applications.
- [ ] Internal metrics remain internally consistent.
- [ ] `mvn clean verify` passes.
- [ ] Animal Sniffer passes against Java 1.7.
- [ ] Representative production classes remain bytecode version 51.
- [ ] `README.md` and this file reflect any changed user-visible behavior or architecture.
