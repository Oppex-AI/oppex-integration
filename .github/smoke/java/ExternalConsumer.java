import dev.oppex.sdk.api.IncidentClient;
import dev.oppex.sdk.model.IncidentRequest;
import dev.oppex.sdk.model.Severity;

/** Compiled from scratch by each CI JDK to verify the supported consumer API. */
public final class ExternalConsumer {
    private ExternalConsumer() {
    }

    public static void main(String[] args) throws Exception {
        Class.forName("org.apache.http.impl.client.CloseableHttpClient");
        Class.forName("com.fasterxml.jackson.core.JsonFactory");

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
}
