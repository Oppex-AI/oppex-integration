package dev.oppex.sdk.examples.compatibility;

import dev.oppex.sdk.api.IncidentClient;
import dev.oppex.sdk.model.IncidentRequest;
import dev.oppex.sdk.model.Severity;

import java.io.Closeable;

/** Network-free source and runtime compatibility example. */
public final class CompatibilitySmoke {
    private static final String SUCCESS_MARKER = "OPPEX_SDK_FAT_JAR_OK";

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
                .tenant("compatibility-tenant")
                .build();
        try {
            assertCondition(client instanceof Closeable, "client must implement Closeable");
            Class.forName("org.apache.http.impl.client.CloseableHttpClient");
            Class.forName("com.fasterxml.jackson.core.JsonFactory");
        } finally {
            client.close();
        }

        System.out.println(SUCCESS_MARKER + " java=" + System.getProperty("java.version"));
    }

    private static void assertCondition(boolean condition, String message) {
        if (!condition) {
            throw new IllegalStateException(message);
        }
    }
}
