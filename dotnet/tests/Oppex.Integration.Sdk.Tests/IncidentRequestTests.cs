namespace Oppex.Integration.Sdk.Tests;

public class IncidentRequestTests
{
    private static IncidentRequest Valid() =>
        new() { Title = "title", Source = "source", Severity = Severity.Medium };

    [Fact]
    public void NormalizeAppliesTheDocumentedDefaults()
    {
        var before = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var normalized = Valid().Normalize();

        Assert.Equal(1, normalized.Priority);
        Assert.True(normalized.SrcTimestamp >= before);
        Assert.Null(normalized.Component);
    }

    [Fact]
    public void NormalizeKeepsExplicitValues()
    {
        var normalized = new IncidentRequest
        {
            Title = "title",
            Source = "source",
            Severity = Severity.High,
            Priority = 4,
            SrcTimestamp = 1_700_000_000_000,
            ServiceKey = "request-service-key",
            Type = "latency",
        }.Normalize();

        Assert.Equal(4, normalized.Priority);
        Assert.Equal(1_700_000_000_000, normalized.SrcTimestamp);
        Assert.Equal("request-service-key", normalized.ServiceKey);
        Assert.Equal("latency", normalized.Type);
    }

    [Fact]
    public void BlankRequiredFieldsAreRejected()
    {
        Assert.Throws<ArgumentException>(() => (Valid() with { Title = "   " }).Validate());
        Assert.Throws<ArgumentException>(() => (Valid() with { Source = "" }).Validate());
    }

    [Fact]
    public void TheSourceLengthCapIsEnforced()
    {
        (Valid() with { Source = new string('a', 255) }).Validate();

        Assert.Throws<ArgumentException>(() => (Valid() with { Source = new string('a', 256) }).Validate());
    }

    [Fact]
    public void AnUndefinedSeverityIsRejected() =>
        Assert.Throws<ArgumentException>(() => (Valid() with { Severity = (Severity)9 }).Validate());

    [Theory]
    [InlineData(0)]
    [InlineData(6)]
    [InlineData(-1)]
    public void AnOutOfRangePriorityIsRejected(int priority) =>
        Assert.Throws<ArgumentException>(() => (Valid() with { Priority = priority }).Validate());

    [Theory]
    [InlineData(0L)]
    [InlineData(-1L)]
    public void ANonPositiveTimestampIsRejected(long timestamp) =>
        Assert.Throws<ArgumentException>(() => (Valid() with { SrcTimestamp = timestamp }).Validate());

    [Fact]
    public void ABlankOptionalFieldIsRejected()
    {
        Assert.Throws<ArgumentException>(() => (Valid() with { Component = "  " }).Validate());
        Assert.Throws<ArgumentException>(() => (Valid() with { ServiceKey = "" }).Validate());
        Assert.Throws<ArgumentException>(() => (Valid() with { Details = "\t" }).Validate());
    }
}
