# Java Consumer Smoke Guide

`ExternalConsumer.java` must remain valid Java 7 source and import only the six supported SDK API types. CI compiles it with only the generated `java/sdk-bundle` fat JAR on the classpath, then runs it without contacting Oppex.

Keep representative Apache HttpClient and Jackson linkage checks string-based so third-party types do not become part of the supported source API.
