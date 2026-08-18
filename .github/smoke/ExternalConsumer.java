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
                .tenant("external-consumer-tenant")
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
        System.out.println("EXTERNAL_CONSUMER_OK java=" + System.getProperty("java.version"));
    }
}
