namespace Oppex.Integration.Sdk;

/// <summary>
/// Oppex incident severity, on a scale from 1 (lowest) to 5 (highest).
/// </summary>
/// <remarks>
/// The enum values are the wire values, so casting to <see cref="int"/> is the
/// conversion and no lookup table is needed.
/// </remarks>
public enum Severity
{
    /// <summary>Wire value 1.</summary>
    Lowest = 1,

    /// <summary>Wire value 2.</summary>
    Low = 2,

    /// <summary>Wire value 3.</summary>
    Medium = 3,

    /// <summary>Wire value 4.</summary>
    High = 4,

    /// <summary>Wire value 5.</summary>
    Critical = 5,
}

/// <summary>Helpers for <see cref="Severity"/>.</summary>
public static class SeverityExtensions
{
    /// <summary>Returns whether the value is within the Oppex scale of 1 to 5.</summary>
    /// <remarks>
    /// A C# enum accepts any value of its underlying type, so
    /// <c>(Severity)99</c> compiles and has to be rejected at runtime.
    /// </remarks>
    public static bool IsDefinedValue(this Severity severity) =>
        severity is >= Severity.Lowest and <= Severity.Critical;
}
