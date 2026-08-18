package dev.oppex.sdk.builder;

import dev.oppex.sdk.api.IncidentClient;
import org.junit.Test;

import static org.junit.Assert.assertNotNull;

public class IncidentClientBuilderTest {
    @Test
    public void buildsClientFromMinimalConfiguration() {
        IncidentClient client = IncidentClient.builder()
                .apiKey("api-key")
                .serviceKey("service-key")
                .tenant("tenant")
                .build();
        try {
            assertNotNull(client);
        } finally {
            client.close();
        }
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsMissingApiKey() {
        IncidentClient.builder().serviceKey("service-key").tenant("tenant").build();
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsBlankServiceKey() {
        IncidentClient.builder().apiKey("api-key").serviceKey(" ").tenant("tenant").build();
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsNullTenant() {
        IncidentClient.builder().apiKey("api-key").serviceKey("service-key").build();
    }
}

