using System.Net;
using Humo.Domain.Access;

namespace Humo.Api.Tests;

/// <summary>Feature switches from the API: built screens are on unless configuration turns one off.</summary>
public sealed class FeatureSwitchTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    [Fact]
    public async Task Receipt_capture_meter_readings_and_levy_models_are_on_for_a_signed_in_person()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.Client().GetAsync("/api/me/flags")).StatusCode);
        var org = await api.Customer("Acacia");
        await api.Person("priya@acacia.example", Roles.Finance, org);
        var flags = await (await (await api.SignedIn("priya@acacia.example")).GetAsync("/api/me/flags")).Json();
        Assert.True(flags.GetProperty("receipt-capture").GetBoolean());
        Assert.True(flags.GetProperty("meter-readings").GetBoolean());
        Assert.True(flags.GetProperty("levy-model").GetBoolean());

        using var off = new HumoApiFactory().With("FeatureSwitches:receipt-capture", "false");
        var o = await off.Customer("Acacia");
        await off.Person("priya@acacia.example", Roles.Finance, o);
        Assert.False((await (await (await off.SignedIn("priya@acacia.example")).GetAsync("/api/me/flags")).Json()).GetProperty("receipt-capture").GetBoolean());
    }
}
