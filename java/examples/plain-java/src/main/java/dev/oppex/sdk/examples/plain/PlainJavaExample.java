package dev.oppex.sdk.examples.plain;

import dev.oppex.sdk.api.IncidentClient;
import dev.oppex.sdk.model.IncidentRequest;
import dev.oppex.sdk.model.Severity;

public final class PlainJavaExample {
    private PlainJavaExample() {
    }

    public static void main(String[] args) {
        IncidentClient client = IncidentClient.builder()
                .apiKey(System.getenv("OPPEX_API_KEY"))
                .serviceKey(System.getenv("OPPEX_SERVICE_KEY"))
                .build();
        try {
            client.postAsync(IncidentRequest.builder()
                    .title("Example incident")
                    .source("plain-java")
                    .severity(Severity.LOW)
                    .details("{\"example\":true}")
                    .build());
        } finally {
            client.close();
        }
    }
}
