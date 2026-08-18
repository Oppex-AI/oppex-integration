package dev.oppex.sdk.model;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class SeverityTest {
    @Test
    public void mapsEverySupportedValue() {
        assertEquals(Severity.LOWEST, Severity.fromValue(1));
        assertEquals(Severity.CRITICAL, Severity.fromValue(5));
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsUnsupportedValue() {
        Severity.fromValue(0);
    }
}

