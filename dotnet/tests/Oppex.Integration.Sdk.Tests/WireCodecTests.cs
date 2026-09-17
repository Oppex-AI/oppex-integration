using Oppex.Integration.Sdk.Internal;

namespace Oppex.Integration.Sdk.Tests;

public class WireCodecTests
{
    private static NormalizedRequest Request(
        string? component = null, string? group = null, string? type = null, string? details = null) =>
        new("title", "source", (int)Severity.High, 2, 1_700_000_000_000, null, component, group, type, details);

    [Fact]
    public void AbsentOptionalFieldsAreOmitted()
    {
        var payload = WireCodec.ToText(WireCodec.SerializeRequest(Request(), null));

        Assert.Equal(
            """{"title":"title","source":"source","severity":4,"priority":2,"srcTimestamp":1700000000000}""",
            payload);
    }

    [Fact]
    public void TheAgreedFieldNamesAndOrderAreUsed()
    {
        var payload = WireCodec.ToText(WireCodec.SerializeRequest(
            Request("api", "payments", "latency", """{"p99":1200}"""), "resolved-service-key"));

        // Utf8JsonWriter escapes the quotes inside detailsJSON as \u0022 by
        // default. That is valid JSON and decodes identically, which the round
        // trip below asserts rather than pinning the escape form alone.
        const string Expected =
            """
            {"serviceKey":"resolved-service-key","title":"title","source":"source","severity":4,"priority":2,"srcTimestamp":1700000000000,"component":"api","group":"payments","type":"latency","detailsJSON":"{\u0022p99\u0022:1200}"}
            """;

        Assert.Equal(Expected, payload);
        Assert.Equal(
            """{"p99":1200}""",
            System.Text.Json.JsonDocument.Parse(payload).RootElement.GetProperty("detailsJSON").GetString());
    }

    [Fact]
    public void TheEnvelopeIsRead()
    {
        var response = WireCodec.ParseResponse(
            200, """{"success":true,"code":201,"message":"created","data":"INC-1"}""");

        Assert.True(response.Successful);
        Assert.Equal(201, response.Code);
        Assert.Equal("created", response.Message);
        Assert.Equal("INC-1", response.IncidentId);
    }

    [Fact]
    public void AnEmptyBodyFallsBackToTheHttpStatus()
    {
        var response = WireCodec.ParseResponse(202, "   ");

        Assert.True(response.Successful);
        Assert.Equal(202, response.Code);
        Assert.Null(response.IncidentId);
    }

    [Fact]
    public void WronglyTypedEnvelopeFieldsAreIgnored()
    {
        var response = WireCodec.ParseResponse(200, """{"success":"yes","code":"201","message":7,"data":[]}""");

        Assert.True(response.Successful);
        Assert.Equal(200, response.Code);
        Assert.Null(response.Message);
        Assert.Null(response.IncidentId);
    }

    [Fact]
    public void ANonJsonBodyIsNeverEchoedBack()
    {
        var failure = Assert.Throws<IncidentException>(
            () => WireCodec.ParseResponse(502, "<html>X-API-KEY: super-secret</html>"));

        Assert.DoesNotContain("super-secret", failure.Message, StringComparison.Ordinal);
        Assert.Equal(502, failure.StatusCode);
    }
}
