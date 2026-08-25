package dev.oppex.sdk.api;

import dev.oppex.sdk.exception.IncidentException;
import dev.oppex.sdk.model.IncidentRequest;
import org.junit.Test;

public class IncidentClientTest {
    @Test(expected = IllegalStateException.class)
    public void postRequiresAServiceKeySomewhere() throws IncidentException {
        IncidentClient client = IncidentClient.builder().apiKey("api-key").build();
        try {
            client.post(request(null));
        } finally {
            client.close();
        }
    }

    @Test(expected = IllegalStateException.class)
    public void postAsyncRequiresAServiceKeySomewhere() {
        IncidentClient client = IncidentClient.builder().apiKey("api-key").serviceKey(" ").build();
        try {
            client.postAsync(request(null));
        } finally {
            client.close();
        }
    }

    @Test(expected = IllegalArgumentException.class)
    public void serviceRoutingRejectsARequestServiceKey() throws IncidentException {
        IncidentClient client = IncidentClient.builder().apiKey("api-key").build();
        try {
            client.postWithServiceRouting(request("request-service"));
        } finally {
            client.close();
        }
    }

    @Test(expected = IllegalArgumentException.class)
    public void asyncServiceRoutingRejectsARequestServiceKey() {
        IncidentClient client = IncidentClient.builder().apiKey("api-key").build();
        try {
            client.postAsyncWithServiceRouting(request("request-service"));
        } finally {
            client.close();
        }
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsNullRequestOnServiceRouting() throws IncidentException {
        IncidentClient client = IncidentClient.builder().apiKey("api-key").build();
        try {
            client.postWithServiceRouting(null);
        } finally {
            client.close();
        }
    }

    @Test(expected = IncidentException.class)
    public void serviceRoutingAfterCloseFailsLikePost() throws IncidentException {
        IncidentClient client = IncidentClient.builder().apiKey("api-key").build();
        client.close();
        client.postWithServiceRouting(request(null));
    }

    private static IncidentRequest request(String serviceKey) {
        return IncidentRequest.builder()
                .title("Failure")
                .source("Test")
                .severity(2)
                .serviceKey(serviceKey)
                .build();
    }
}
