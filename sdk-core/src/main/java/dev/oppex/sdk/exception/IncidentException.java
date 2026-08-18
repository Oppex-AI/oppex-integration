package dev.oppex.sdk.exception;

/** Checked failure raised by synchronous incident delivery. */
public class IncidentException extends Exception {
    private static final long serialVersionUID = 1L;

    private final int statusCode;
    private final boolean retryable;

    public IncidentException(String message) {
        this(message, null, -1, false);
    }

    public IncidentException(String message, Throwable cause) {
        this(message, cause, -1, false);
    }

    public IncidentException(String message, int statusCode, boolean retryable) {
        this(message, null, statusCode, retryable);
    }

    public IncidentException(String message, Throwable cause, int statusCode, boolean retryable) {
        super(message, cause);
        this.statusCode = statusCode;
        this.retryable = retryable;
    }

    /** Returns the HTTP status, or -1 when no HTTP response was received. */
    public int getStatusCode() {
        return statusCode;
    }

    /** Returns whether the underlying failure is eligible for retry. */
    public boolean isRetryable() {
        return retryable;
    }
}

