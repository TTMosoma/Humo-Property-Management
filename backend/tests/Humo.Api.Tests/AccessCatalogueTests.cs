using Humo.Domain.Access;
using Humo.Infrastructure.Messaging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Humo.Api.Tests;

/// <summary>The fixed roles come from contracts/role-permissions.json (D4), shared with the frontend.</summary>
public sealed class AccessCatalogueTests
{
    [Fact]
    public void Every_role_the_frontend_knows_is_loaded()
    {
        Assert.Equal(11, AccessCatalogue.Roles.Count);
        foreach (var role in new[] { Roles.AgencyAdmin, Roles.PortfolioManager, Roles.Trustee, Roles.SystemAdmin, Roles.AccountManager })
            Assert.True(AccessCatalogue.IsRole(role), role);
    }

    [Fact]
    public void Individual_grants_add_to_a_role_but_unknown_ones_are_ignored()
    {
        var withGrant = AccessCatalogue.PermissionsOf(Roles.PortfolioManager, ["Portfolio.BrowseAgency", "Made.Up"]);
        Assert.Contains("Portfolio.BrowseAgency", withGrant);
        Assert.DoesNotContain("Made.Up", withGrant);
        Assert.DoesNotContain("Portfolio.BrowseAgency", AccessCatalogue.PermissionsOf(Roles.PortfolioManager));
    }

    [Fact]
    public void Step_up_flags_match_the_contract()
    {
        Assert.True(AccessCatalogue.Permissions["Payables.Release"].StepUp);
        Assert.False(AccessCatalogue.Permissions["Work.View"].Mutates);
    }

    [Fact]
    public async Task The_SMS_provider_is_chosen_by_configuration()
    {
        ISmsSender[] senders = [new LogSmsSender(NullLogger<LogSmsSender>.Instance), new SmsSouthAfricaSender(Options.Create(new SmsOptions()))];

        var log = new SmsGateway(senders, Options.Create(new SmsOptions { Provider = "log" }));
        Assert.Equal("Log", log.Current.Name);
        Assert.True((await log.SendAsync(new SmsMessage("+27820000000", "Test"))).Accepted);

        var unknown = new SmsGateway(senders, Options.Create(new SmsOptions { Provider = "Carrier pigeon" }));
        Assert.Throws<InvalidOperationException>(() => unknown.Current);

        // Chosen, but not wired until SMSSouthAfrica's API documentation arrives: it refuses rather than pretending.
        var sa = new SmsGateway(senders, Options.Create(new SmsOptions { Provider = "SmsSouthAfrica" }));
        await Assert.ThrowsAsync<NotSupportedException>(() => sa.SendAsync(new SmsMessage("+27820000000", "Test")));
    }
}
