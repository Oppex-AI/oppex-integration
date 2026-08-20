package dev.oppex.sdk.model;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class IncidentRequestTest {
    @Test
    public void buildsImmutableValidatedRequest() {
        IncidentRequest request = IncidentRequest.builder()
                .title("Deploy failed")
                .source("Deploy")
                .severity(2)
                .details("{\"commit\":\"abc\"}")
                .build();

        assertEquals("Deploy failed", request.getTitle());
        assertEquals(Severity.LOW, request.getSeverity());
        assertEquals(1, request.getPriority());
        assertTrue(request.getSrcTimestamp() > 0L);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsBlankTitle() {
        IncidentRequest.builder().title("  ").source("Deploy").severity(2).build();
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsNullSeverity() {
        IncidentRequest.builder().title("Failure").source("Deploy").severity((Severity) null).build();
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsInvalidNumericSeverityAtBuildTime() {
        IncidentRequest.builder().title("Failure").source("Deploy").severity(6).build();
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsInvalidTimestamp() {
        IncidentRequest.builder().title("Failure").source("Deploy").severity(2).srcTimestamp(0L).build();
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsBlankOptionalField() {
        IncidentRequest.builder().title("Failure").source("Deploy").severity(2).component(" ").build();
    }
}
