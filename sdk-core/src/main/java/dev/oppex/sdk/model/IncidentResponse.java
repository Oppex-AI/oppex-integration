package dev.oppex.sdk.model;

/** Immutable result returned by a synchronous incident submission. */
public final class IncidentResponse {
    private final boolean successful;
    private final int code;
    private final String message;
    private final String incidentId;

    public IncidentResponse(boolean successful, int code, String message, String incidentId) {
        this.successful = successful;
        this.code = code;
        this.message = message;
        this.incidentId = incidentId;
    }

    public boolean isSuccessful() {
        return successful;
    }

    public int getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }

    public String getIncidentId() {
        return incidentId;
    }
}

