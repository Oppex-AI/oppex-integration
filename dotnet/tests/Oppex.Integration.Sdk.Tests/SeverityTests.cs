namespace Oppex.Integration.Sdk.Tests;

public class SeverityTests
{
    [Theory]
    [InlineData(Severity.Lowest, 1)]
    [InlineData(Severity.Low, 2)]
    [InlineData(Severity.Medium, 3)]
    [InlineData(Severity.High, 4)]
    [InlineData(Severity.Critical, 5)]
    public void WireValuesMatchTheOppexScale(Severity severity, int expected) =>
        Assert.Equal(expected, (int)severity);

    [Theory]
    [InlineData(Severity.Lowest)]
    [InlineData(Severity.Critical)]
    public void EverySeverityOnTheScaleIsDefined(Severity severity) =>
        Assert.True(severity.IsDefinedValue());

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(6)]
    [InlineData(99)]
    public void ValuesOutsideTheScaleAreNotDefined(int value) =>
        Assert.False(((Severity)value).IsDefinedValue());
}
