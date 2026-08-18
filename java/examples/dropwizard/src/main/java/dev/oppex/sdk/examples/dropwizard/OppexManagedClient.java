package dev.oppex.sdk.examples.dropwizard;

import dev.oppex.sdk.api.IncidentClient;
import io.dropwizard.lifecycle.Managed;

public final class OppexManagedClient implements Managed {
    private final IncidentClient client;

    public OppexManagedClient(String apiKey, String serviceKey, String tenant) {
        this.client = IncidentClient.builder()
                .apiKey(apiKey)
                .serviceKey(serviceKey)
                .tenant(tenant)
                .build();
    }

    public IncidentClient getClient() {
        return client;
    }

    public void start() {
        // The SDK initializes eagerly and does not require a start hook.
    }

    public void stop() {
        client.close();
    }
}

