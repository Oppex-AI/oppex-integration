using System.Buffers;
using System.Text;
using System.Text.Json;

namespace Oppex.Integration.Sdk.Internal;

/// <summary>
/// Renders the wire payload and decodes the response envelope. Not public API.
/// </summary>
/// <remarks>
/// Written against <see cref="Utf8JsonWriter"/> and <see cref="JsonDocument"/>
/// rather than reflection-based serialization: it keeps the agreed field order,
/// makes "absent is omitted, never null" a property of the code instead of an
/// attribute, and leaves the assembly trimmable and AOT-safe.
/// </remarks>
internal static class WireCodec
{
    /// <summary>
    /// A null resolved service key is omitted entirely so the API routes the
    /// incident by its own rules. Every other absent optional field is omitted
    /// rather than sent as null.
    /// </summary>
    internal static byte[] SerializeRequest(NormalizedRequest request, string? resolvedServiceKey)
    {
        var buffer = new ArrayBufferWriter<byte>(512);
        using (var json = new Utf8JsonWriter(buffer))
        {
            json.WriteStartObject();
            WriteOptionalString(json, "serviceKey", resolvedServiceKey);
            json.WriteString("title", request.Title);
            json.WriteString("source", request.Source);
            json.WriteNumber("severity", request.Severity);
            json.WriteNumber("priority", request.Priority);
            json.WriteNumber("srcTimestamp", request.SrcTimestamp);
            WriteOptionalString(json, "component", request.Component);
            WriteOptionalString(json, "group", request.Group);
            WriteOptionalString(json, "type", request.Type);
            WriteOptionalString(json, "detailsJSON", request.Details);
            json.WriteEndObject();
        }

        return buffer.WrittenSpan.ToArray();
    }

    /// <summary>
    /// Decodes a response body, falling back to the HTTP status for any field the
    /// body does not carry.
    /// </summary>
    /// <remarks>
    /// A body that is not JSON is never echoed into the thrown exception: a proxy
    /// or WAF can return an error page that repeats request headers, including
    /// X-API-KEY, and that text would then leak into the host's logs.
    /// </remarks>
    internal static IncidentResponse ParseResponse(int httpStatus, string? body)
    {
        var successful = httpStatus is >= 200 and < 300;
        if (string.IsNullOrWhiteSpace(body))
        {
            return new IncidentResponse(successful, httpStatus, null, null);
        }

        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                throw new IncidentException(
                    $"Oppex returned a non-object JSON response (status {httpStatus})", httpStatus, retryable: false);
            }

            var root = document.RootElement;
            return new IncidentResponse(
                ReadBoolean(root, "success") ?? successful,
                ReadInt32(root, "code") ?? httpStatus,
                ReadString(root, "message"),
                ReadString(root, "data"));
        }
        catch (JsonException failure)
        {
            throw new IncidentException(
                $"Oppex returned a non-JSON response (status {httpStatus})", httpStatus, retryable: false, failure);
        }
    }

    private static void WriteOptionalString(Utf8JsonWriter json, string name, string? value)
    {
        if (value is not null)
        {
            json.WriteString(name, value);
        }
    }

    private static bool? ReadBoolean(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : null;

    private static int? ReadInt32(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt32(out var number)
            ? number
            : null;

    private static string? ReadString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>Decodes a payload back to text. Used only by tests.</summary>
    internal static string ToText(byte[] payload) => Encoding.UTF8.GetString(payload);
}
