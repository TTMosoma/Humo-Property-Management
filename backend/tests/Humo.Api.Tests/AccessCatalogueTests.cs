using Humo.Domain.Access;

namespace Humo.Api.Tests;

/// <summary>The fixed roles come from contracts/role-permissions.json (D4), shared with the frontend.</summary>
public sealed class AccessCatalogueTests
{
    [Fact]
    public void Every_role_the_frontend_knows_is_loaded()
    {
        Assert.Equal(12, AccessCatalogue.Roles.Count);
        foreach (var role in new[] { Roles.AgencyAdmin, Roles.PortfolioManager, Roles.Trustee, Roles.SystemAdmin, Roles.AccountManager, Roles.HumoFinance })
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
}
