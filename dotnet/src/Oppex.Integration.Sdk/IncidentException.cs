namespace Oppex.Integration.Sdk;

/// <summary>Thrown when incident delivery was attempted and failed.</summary>
/// <remarks>
/// Validation failures throw <see cref="ArgumentException"/> and a post made
/// after disposal throws <see cref="ObjectDisposedException"/>; neither reaches
/// the network, so neither is an <see cref="IncidentException"/>.
/// </remarks>
public sealed class IncidentException : Exception
{
    /// <summary>
    /// The <see cref="StatusCode"/> reported when delivery failed before any
    /// HTTP status line was received.
    /// </summary>
    public const int NoStatusCode = -1;

    /// <summary>Creates a failure that never reached a status line.</summary>
    public IncidentException(string message)
        : this(message, NoStatusCode, retryable: false, innerException: null)
    {
    }

    /// <summary>Creates a failure that never reached a status line.</summary>
    public IncidentException(string message, Exception? innerException)
        : this(message, NoStatusCode, retryable: false, innerException)
    {
    }

    /// <summary>Creates a failure carrying its HTTP status and retry decision.</summary>
    public IncidentException(string message, int statusCode, bool retryable, Exception? innerException = null)
        : base(message, innerException)
    {
        StatusCode = statusCode;
        Retryable = retryable;
    }

    /// <summary>
    /// The HTTP status, or <see cref="NoStatusCode"/> when no response arrived.
    /// </summary>
    public int StatusCode { get; }

    /// <summary>Whether the failure was eligible for retry.</summary>
    public bool Retryable { get; }

    /// <summary>Whether an HTTP status was received at all.</summary>
    public bool HasHttpStatus => StatusCode != NoStatusCode;
}
