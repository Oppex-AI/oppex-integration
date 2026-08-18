package dev.oppex.sdk.builder;

import dev.oppex.sdk.api.IncidentClient;

/** Builder for a reusable {@link IncidentClient}. */
public final class IncidentClientBuilder {
    private String apiKey;
    private String serviceKey;
    private String tenant;

    public IncidentClientBuilder() {
    }

    public IncidentClientBuilder apiKey(String apiKey) {
        this.apiKey = apiKey;
        return this;
    }

    public IncidentClientBuilder serviceKey(String serviceKey) {
        this.serviceKey = serviceKey;
        return this;
    }

    public IncidentClientBuilder tenant(String tenant) {
        this.tenant = tenant;
        return this;
    }

    public IncidentClient build() {
        requireNonBlank(apiKey, "apiKey");
        requireNonBlank(serviceKey, "serviceKey");
        requireNonBlank(tenant, "tenant");
        return new IncidentClient(apiKey, serviceKey, tenant);
    }

    private static void requireNonBlank(String value, String name) {
        if (value == null) {
            throw new IllegalArgumentException(name + " must not be null");
        }
        if (value.trim().length() == 0) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }
}
