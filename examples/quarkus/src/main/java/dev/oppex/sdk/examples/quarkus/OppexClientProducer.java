package dev.oppex.sdk.examples.quarkus;

import dev.oppex.sdk.api.IncidentClient;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

@ApplicationScoped
public class OppexClientProducer {
    private final IncidentClient client = IncidentClient.builder()
            .apiKey(requiredEnvironment("OPPEX_API_KEY"))
            .serviceKey(requiredEnvironment("OPPEX_SERVICE_KEY"))
            .tenant(requiredEnvironment("OPPEX_TENANT"))
            .build();

    @Produces
    @ApplicationScoped
    public IncidentClient incidentClient() {
        return client;
    }

    @PreDestroy
    void close() {
        client.close();
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.trim().length() == 0) {
            throw new IllegalStateException(name + " is required");
        }
        return value;
    }
}

