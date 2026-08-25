import dev.oppex.sdk.api.IncidentClient;
import dev.oppex.sdk.model.IncidentRequest;
import dev.oppex.sdk.model.Severity;

/** Compiled from scratch by each CI JDK to verify the supported consumer API. */
public final class ExternalConsumer {
    private static final String SHADED_PREFIX = "dev.oppex.sdk.shaded.";

    private ExternalConsumer() {
    }

    public static void main(String[] args) throws Exception {
        assertRelocated("org.apache.http.impl.client.CloseableHttpClient");
        assertRelocated("com.fasterxml.jackson.core.JsonFactory");

        IncidentClient client = IncidentClient.builder()
                .apiKey("external-consumer-api-key")
                .serviceKey("external-consumer-service-key")
                .build();
        try {
            IncidentRequest request = IncidentRequest.builder()
                    .title("External consumer compilation test")
                    .source("github-actions")
                    .severity(Severity.MEDIUM)
                    .build();
            if (request.getSeverity().getValue() != 3) {
                throw new IllegalStateException("Unexpected severity mapping");
            }
        } finally {
            client.close();
        }

        // Service routing needs no service key, and its precondition fails before any network call.
        IncidentClient routingClient = IncidentClient.builder()
                .apiKey("external-consumer-api-key")
                .build();
        try {
            IncidentRequest keyed = IncidentRequest.builder()
                    .title("Service routing compilation test")
                    .source("github-actions")
                    .severity(Severity.LOW)
                    .serviceKey("external-consumer-service-key")
                    .build();
            try {
                routingClient.postWithServiceRouting(keyed);
                throw new IllegalStateException("Expected a request service key to be rejected");
            } catch (IllegalArgumentException expected) {
                // Service routing must refuse a request that carries its own service key.
            }
        } finally {
            routingClient.close();
        }
        System.out.println("EXTERNAL_CONSUMER_OK java=" + System.getProperty("java.version"));
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
}
