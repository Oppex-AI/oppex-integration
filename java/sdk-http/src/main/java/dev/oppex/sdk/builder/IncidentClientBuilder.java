package dev.oppex.sdk.builder;

import dev.oppex.sdk.api.IncidentClient;

/** Builder for a reusable {@link IncidentClient}. */
public final class IncidentClientBuilder {
    private String apiKey;
    private String serviceKey;

    public IncidentClientBuilder() {
    }

    public IncidentClientBuilder apiKey(String apiKey) {
        this.apiKey = apiKey;
        return this;
    }

    /**
     * Optional. When omitted, incidents must be posted with
     * {@link IncidentClient#postWithServiceRouting(dev.oppex.sdk.model.IncidentRequest)}.
     */
    public IncidentClientBuilder serviceKey(String serviceKey) {
        this.serviceKey = serviceKey;
        return this;
    }

    public IncidentClient build() {
        requireNonBlank(apiKey, "apiKey");
        return new IncidentClient(apiKey, serviceKey);
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
