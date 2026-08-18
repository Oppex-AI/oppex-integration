package dev.oppex.sdk.model;

/**
 * Oppex incident severity. Oppex uses a scale from 1 (lowest) to 5 (highest).
 */
public enum Severity {
    LOWEST(1),
    LOW(2),
    MEDIUM(3),
    HIGH(4),
    CRITICAL(5);

    private final int value;

    Severity(int value) {
        this.value = value;
    }

    /** Returns the numeric value sent to Oppex. */
    public int getValue() {
        return value;
    }

    /**
     * Returns the severity for an Oppex numeric value.
     *
     * @throws IllegalArgumentException when {@code value} is outside 1 through 5
     */
    public static Severity fromValue(int value) {
        Severity[] values = values();
        for (int i = 0; i < values.length; i++) {
            if (values[i].value == value) {
                return values[i];
            }
        }
        throw new IllegalArgumentException("severity must be between 1 and 5");
    }
}

