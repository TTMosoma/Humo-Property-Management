using Humo.Api.Startup;
using Microsoft.Extensions.Configuration;

namespace Humo.Api.Tests;

/// <summary>The API won't start in Production with anything switched off or in test mode (docs/18 D-4, D-17, D-18).</summary>
public sealed class ProductionSettingsTests
{
    private static IConfiguration Config(Dictionary<string, string?> values) => new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    private static readonly Dictionary<string, string?> Live = new()
    {
        ["Mail:Provider"] = "Smtp",
        ["Sms:Provider"] = "SmsSouthAfrica",
        ["Sms:SmsSouthAfrica:TestMode"] = "false",
        ["Sms:SmsSouthAfrica:ClientId"] = "client",
        ["Sms:SmsSouthAfrica:ApiSecret"] = "secret",
        ["Payments:Payfast:Sandbox"] = "false",
    };

    [Fact]
    public void Live_settings_pass() => Assert.Empty(ProductionSettings.Problems(Config(Live)));

    [Fact]
    public void Test_modes_and_switched_off_providers_are_named()
    {
        var problems = ProductionSettings.Problems(Config(new(Live) { ["Sms:SmsSouthAfrica:TestMode"] = "true", ["Payments:Payfast:Sandbox"] = "true", ["Mail:Provider"] = "Log" }));
        Assert.Equal(3, problems.Count);
        Assert.Contains(problems, p => p.Contains("SMS_SOUTHAFRICA_TEST_MODE=false"));
        Assert.Contains(problems, p => p.Contains("PAYFAST_SANDBOX=false"));
        Assert.Contains(problems, p => p.StartsWith("Mail:Provider is Log"));

        // Unset: SMS is off and Payfast is in its sandbox by default.
        var unset = ProductionSettings.Problems(Config(new() { ["Mail:Provider"] = "Smtp" }));
        Assert.Contains(unset, p => p.StartsWith("Sms:Provider is Log"));
        Assert.Contains(unset, p => p.StartsWith("Payments:Payfast:Sandbox is true"));
    }
}
