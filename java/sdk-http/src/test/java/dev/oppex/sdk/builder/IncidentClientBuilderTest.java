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
                .build();
        try {
            assertNotNull(client);
        } finally {
            client.close();
        }
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsMissingApiKey() {
        IncidentClient.builder().serviceKey("service-key").build();
    }

    @Test
    public void buildsClientWithoutServiceKeyForServiceRouting() {
        IncidentClient client = IncidentClient.builder().apiKey("api-key").build();
        try {
            assertNotNull(client);
        } finally {
            client.close();
        }
    }

    @Test
    public void buildsClientWhenServiceKeyIsBlank() {
        IncidentClient client = IncidentClient.builder().apiKey("api-key").serviceKey(" ").build();
        try {
            assertNotNull(client);
        } finally {
            client.close();
        }
    }
}
