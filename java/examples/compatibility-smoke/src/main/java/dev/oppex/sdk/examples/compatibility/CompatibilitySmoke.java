package dev.oppex.sdk.examples.compatibility;

import dev.oppex.sdk.api.IncidentClient;
import dev.oppex.sdk.model.IncidentRequest;
import dev.oppex.sdk.model.Severity;

import java.io.Closeable;

/** Network-free source and runtime compatibility example. */
public final class CompatibilitySmoke {
    private static final String SUCCESS_MARKER = "OPPEX_SDK_FAT_JAR_OK";
    private static final String SHADED_PREFIX = "dev.oppex.sdk.shaded.";

    private CompatibilitySmoke() {
    }

    public static void main(String[] args) throws Exception {
        IncidentRequest request = IncidentRequest.builder()
                .title("Compatibility smoke test")
                .source("github-actions")
                .severity(Severity.LOW)
                .priority(1)
                .details("{\"networkCall\":false}")
                .build();

        assertCondition(request.getSeverity() == Severity.LOW, "severity mapping failed");
        assertCondition(request.getSrcTimestamp() > 0L, "timestamp default failed");
        assertCondition(Severity.fromValue(5) == Severity.CRITICAL, "numeric severity mapping failed");

        IncidentClient client = IncidentClient.builder()
                .apiKey("compatibility-api-key")
                .serviceKey("compatibility-service-key")
                .build();
        try {
            assertCondition(client instanceof Closeable, "client must implement Closeable");
            assertRelocated("org.apache.http.impl.client.CloseableHttpClient");
            assertRelocated("com.fasterxml.jackson.core.JsonFactory");
        } finally {
            client.close();
        }

        System.out.println(SUCCESS_MARKER + " java=" + System.getProperty("java.version"));
    }

    /**
     * The bundle must carry each dependency under its relocated name only. An unrelocated copy would
     * sit ahead of an application's own Jackson or HttpClient on the classpath and shadow it.
     */
    private static void assertRelocated(String originalName) throws Exception {
        Class.forName(SHADED_PREFIX + originalName);
        try {
            Class.forName(originalName);
            throw new IllegalStateException("Bundled dependency is not relocated: " + originalName);
        } catch (ClassNotFoundException expected) {
            // Only the relocated copy may ship inside the bundle.
        }
    }

    private static void assertCondition(boolean condition, String message) {
        if (!condition) {
            throw new IllegalStateException(message);
        }
    }
}
