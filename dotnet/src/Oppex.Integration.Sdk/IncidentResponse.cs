namespace Oppex.Integration.Sdk;

/// <summary>The result of a delivered incident.</summary>
/// <param name="Successful">
/// The API's own success flag, defaulting to whether the HTTP status was 2xx when
/// the body does not carry one.
/// </param>
/// <param name="Code">The API's own code, defaulting to the HTTP status.</param>
/// <param name="Message">The API's human-readable message, or null.</param>
/// <param name="IncidentId">The created incident's identifier, or null.</param>
public sealed record IncidentResponse(bool Successful, int Code, string? Message, string? IncidentId);
