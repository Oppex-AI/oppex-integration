namespace Oppex.Integration.Sdk;

/// <summary>A single incident submission.</summary>
/// <remarks>
/// <para>
/// <see cref="Title"/>, <see cref="Source"/> and <see cref="Severity"/> are
/// required. Every other property is optional, and an absent optional property is
/// left out of the payload rather than sent as null.
/// </para>
/// <para>
/// Validation runs when the request is posted, on the calling thread, and is
/// also reachable directly through <see cref="Validate"/>. Object-initializer
/// syntax leaves no constructor to validate in, which is why this type differs
/// from the Java SDK's builder. It is a record so a caller can derive one
/// request from another with <c>with</c>.
/// </para>
/// </remarks>
public sealed record IncidentRequest
{
    /// <summary>The maximum length of <see cref="Source"/>, in characters.</summary>
    public const int MaxSourceLength = 255;

    /// <summary>The incident headline. Required, non-blank.</summary>
    public required string Title { get; init; }

    /// <summary>
    /// The emitting system. Required, non-blank, at most
    /// <see cref="MaxSourceLength"/> characters.
    /// </summary>
    public required string Source { get; init; }

    /// <summary>The severity. Required.</summary>
    public required Severity Severity { get; init; }

    /// <summary>The priority, 1 through 5. Defaults to 1.</summary>
    public int Priority { get; init; } = 1;

    /// <summary>
    /// Milliseconds since the Unix epoch. Defaults to the current time.
    /// </summary>
    public long? SrcTimestamp { get; init; }

    /// <summary>Overrides the service key configured on the client.</summary>
    public string? ServiceKey { get; init; }

    /// <summary>The emitting component.</summary>
    public string? Component { get; init; }

    /// <summary>The owning group.</summary>
    public string? Group { get; init; }

    /// <summary>The incident type.</summary>
    public string? Type { get; init; }

    /// <summary>JSON text sent in the wire-level <c>detailsJSON</c> field.</summary>
    public string? Details { get; init; }

    /// <summary>
    /// Validates the request without posting it. Every post validates anyway, so
    /// this is only useful to reject bad input earlier.
    /// </summary>
    /// <exception cref="ArgumentException">The request is not deliverable.</exception>
    public void Validate() => Normalize();

    /// <summary>
    /// Validates and applies the documented defaults. This is the single place
    /// defaults are resolved, so a synchronous and a queued post can never
    /// disagree about what was sent.
    /// </summary>
    internal NormalizedRequest Normalize()
    {
        RequireNonBlank(Title, nameof(Title));
        RequireNonBlank(Source, nameof(Source));
        if (Source.Length > MaxSourceLength)
        {
            throw new ArgumentException(
                $"{nameof(Source)} must not exceed {MaxSourceLength} characters", nameof(Source));
        }

        if (!Severity.IsDefinedValue())
        {
            throw new ArgumentException($"{nameof(Severity)} must be between 1 and 5", nameof(Severity));
        }

        if (Priority is < 1 or > 5)
        {
            throw new ArgumentException($"{nameof(Priority)} must be between 1 and 5", nameof(Priority));
        }

        var timestamp = SrcTimestamp ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (timestamp <= 0)
        {
            throw new ArgumentException(
                $"{nameof(SrcTimestamp)} must be greater than zero", nameof(SrcTimestamp));
        }

        RejectBlank(ServiceKey, nameof(ServiceKey));
        RejectBlank(Component, nameof(Component));
        RejectBlank(Group, nameof(Group));
        RejectBlank(Type, nameof(Type));
        RejectBlank(Details, nameof(Details));

        return new NormalizedRequest(
            Title, Source, (int)Severity, Priority, timestamp, ServiceKey, Component, Group, Type, Details);
    }

    private static void RequireNonBlank(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException($"{name} must not be blank", name);
        }
    }

    /// <summary>
    /// An optional property may be absent, but a present-yet-blank value is
    /// nearly always a bug at the call site, so it is rejected rather than
    /// silently sent.
    /// </summary>
    private static void RejectBlank(string? value, string name)
    {
        if (value is not null && string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException($"{name} must not be blank when supplied", name);
        }
    }
}

/// <summary>A validated request with every default resolved.</summary>
internal sealed record NormalizedRequest(
    string Title,
    string Source,
    int Severity,
    int Priority,
    long SrcTimestamp,
    string? ServiceKey,
    string? Component,
    string? Group,
    string? Type,
    string? Details);
