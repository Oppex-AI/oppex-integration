package dev.oppex.sdk.internal.http;

import dev.oppex.sdk.model.IncidentRequest;
import dev.oppex.sdk.model.IncidentResponse;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class JsonCodecTest {
    private final JsonCodec codec = new JsonCodec();

    @Test
    public void serializesWireFieldNamesAndEscapedDetails() throws Exception {
        IncidentRequest request = IncidentRequest.builder()
                .title("Deploy \"failed\"")
                .source("Deploy")
                .severity(2)
                .priority(1)
                .srcTimestamp(1787036524808L)
                .component("deploy")
                .group("backend")
                .type("deployment")
                .details("{\"stacktrace\":\"line\\nnext\"}")
                .build();

        String json = codec.serialize(request, "service-key");

        assertTrue(json.contains("\"serviceKey\":\"service-key\""));
        assertTrue(json.contains("\"title\":\"Deploy \\\"failed\\\"\""));
        assertTrue(json.contains("\"severity\":2"));
        assertTrue(json.contains("\"srcTimestamp\":1787036524808"));
        assertFalse(json.contains("\"tenant\""));
        assertTrue(json.contains("\"detailsJSON\":\"{\\\"stacktrace\\\""));
    }

    @Test
    public void requestServiceKeyOverridesClientDefault() throws Exception {
        IncidentRequest request = IncidentRequest.builder()
                .title("Failure")
                .source("Monitor")
                .severity(3)
                .serviceKey("request-service")
                .build();

        String json = codec.serialize(request, "client-service");

        assertTrue(json.contains("\"serviceKey\":\"request-service\""));
        assertFalse(json.contains("client-service"));
    }

    @Test
    public void parsesApiResponse() throws Exception {
        IncidentResponse response = codec.parseResponse(
                "{\"success\":true,\"code\":200,\"message\":\"created\",\"data\":\"inc-123\"}", 200);

        assertTrue(response.isSuccessful());
        assertEquals(200, response.getCode());
        assertEquals("created", response.getMessage());
        assertEquals("inc-123", response.getIncidentId());
    }
}
