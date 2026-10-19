using System.Net;
using System.Net.Http.Json;
using Humo.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Users &amp; access (doc 24 §7), with step-up (C7) and the D1/D2/D3/F-22 rules.</summary>
public sealed class AccessTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private record Setup(Guid Org, Guid Kc, HttpClient Admin);

    private async Task<Setup> Agency()
    {
        var org = await api.Organisation("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var res = await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" });
        return new Setup(org, Guid.Parse((await res.Json()).GetProperty("id").GetString()!), admin);
    }

    private static object Invitation(Guid org, string role, string email, string name = "Lerato Mokoena", List<string>? schemes = null) => new
    {
        organisationId = org.ToString(), name, email,
        assignment = new { role, scope = new { type = schemes is null ? "organisation" : "schemes", organisationId = org.ToString(), schemeIds = schemes ?? [] }, label = "Acacia" },
    };

    [Fact]
    public async Task Inviting_needs_step_up_then_emails_a_week_long_link()
    {
        var s = await Agency();
        var first = await s.Admin.PostAsJsonAsync("/api/access/invitations", Invitation(s.Org, Roles.Finance, "lerato@acacia.example"));
        Assert.Equal("step-up-required", await first.ProblemCode());
        Assert.Empty(api.Email.Sent);

        await s.Admin.StepUp();
        var res = await s.Admin.PostAsJsonAsync("/api/access/invitations", Invitation(s.Org, Roles.Finance, "lerato@acacia.example"));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var mail = Assert.Single(api.Email.Sent);
        Assert.Equal("lerato@acacia.example", mail.To);
        Assert.Contains("invited you", mail.Text);

        // The link still works six days later, and using it accepts the invitation.
        api.Clock.Advance(TimeSpan.FromDays(6));
        var lerato = await api.SignedIn("lerato@acacia.example");
        var me = await (await lerato.GetAsync("/api/me")).Json();
        Assert.Equal("finance", me.GetProperty("assignments")[0].GetProperty("role").GetString());
        Assert.Contains("Invited Lerato Mokoena (lerato@acacia.example) as Finance User · Acacia", await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync()));
    }

    [Fact]
    public async Task Invitations_are_checked()
    {
        var s = await Agency();
        await s.Admin.StepUp();
        var bad = await s.Admin.PostAsJsonAsync("/api/access/invitations", Invitation(s.Org, Roles.Finance, "someone@humo.co.za", "Mononym"));
        var errors = await bad.FieldErrors();
        Assert.True(errors.TryGetProperty("name", out _));
        Assert.Contains("Humo staff address", errors.GetProperty("email").GetString());

        var trustee = await s.Admin.PostAsJsonAsync("/api/access/invitations", Invitation(s.Org, Roles.Trustee, "sipho@mail.example", schemes: [s.Kc.ToString()]));
        Assert.Contains("isn’t on that scheme’s board", (await trustee.FieldErrors()).GetProperty("role").GetString());

        Assert.Equal(HttpStatusCode.Created, (await s.Admin.PostAsJsonAsync("/api/access/invitations", Invitation(s.Org, Roles.Operations, "ops@acacia.example"))).StatusCode);
        var again = await s.Admin.PostAsJsonAsync("/api/access/invitations", Invitation(s.Org, Roles.Finance, "ops@acacia.example"));
        Assert.Contains("already has access here", (await again.FieldErrors()).GetProperty("email").GetString());
    }

    [Fact]
    public async Task A_Portfolio_Manager_invites_residents_of_their_schemes_but_not_staff_D3()
    {
        var s = await Agency();
        await api.Person("johan@acacia.example", Roles.PortfolioManager, s.Org, [s.Kc]);
        var johan = await api.SignedIn("johan@acacia.example");
        await johan.StepUp();
        var staff = await johan.PostAsJsonAsync("/api/access/invitations", Invitation(s.Org, Roles.Finance, "new@acacia.example"));
        Assert.Equal("forbidden", await staff.ProblemCode());
    }

    [Fact]
    public async Task Onboarding_invites_only_the_first_Agency_Administrator_F22()
    {
        var org = await api.Organisation("Marula", OrganisationStatuses.Onboarding);
        var humo = await api.SignedIn(HumoApiFactory.AdminEmail);
        await humo.StepUp();
        var pm = await humo.PostAsJsonAsync("/api/access/invitations", Invitation(org, Roles.PortfolioManager, "pm@marula.example"));
        Assert.Contains("first Agency Administrator", (await pm.FieldErrors()).GetProperty("role").GetString());
        Assert.Equal(HttpStatusCode.Created, (await humo.PostAsJsonAsync("/api/access/invitations", Invitation(org, Roles.AgencyAdmin, "admin@marula.example"))).StatusCode);
    }

    [Fact]
    public async Task Roles_are_granted_and_ended_never_self_and_trustee_needs_a_seat()
    {
        var s = await Agency();
        var johanId = await api.Person("johan@acacia.example", Roles.PortfolioManager, s.Org, [s.Kc]);
        await s.Admin.StepUp();
        var finance = new { role = Roles.Finance, scope = new { type = "organisation", organisationId = s.Org.ToString(), schemeIds = Array.Empty<string>() }, label = "Acacia" };
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/access/identities/{johanId}/assignments", finance)).StatusCode);
        Assert.Contains("already has this role", (await (await s.Admin.PostAsJsonAsync($"/api/access/identities/{johanId}/assignments", finance)).FieldErrors()).GetProperty("role").GetString());

        var trustee = new { role = Roles.Trustee, scope = new { type = "schemes", organisationId = s.Org.ToString(), schemeIds = new[] { s.Kc.ToString() } }, label = "KC" };
        Assert.Contains("board", (await (await s.Admin.PostAsJsonAsync($"/api/access/identities/{johanId}/assignments", trustee)).FieldErrors()).GetProperty("role").GetString());

        var adminId = await api.Db(db => db.Users.Where(u => u.Email == "thandeka@acacia.example").Select(u => u.Id).SingleAsync());
        var self = await s.Admin.PostAsJsonAsync($"/api/access/identities/{adminId}/assignments", finance);
        Assert.Equal("forbidden", await self.ProblemCode());

        var role = await api.Db(db => db.RoleAssignments.Where(a => a.UserId == johanId && a.Role == Roles.Finance).SingleAsync());
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/access/identities/{johanId}/assignments/{role.Id}/end", new { expectedVersion = role.Version })).StatusCode);
        Assert.Equal(AssignmentStatuses.Ended, await api.Db(db => db.RoleAssignments.Where(a => a.Id == role.Id).Select(a => a.Status).SingleAsync()));
    }

    [Fact]
    public async Task The_browse_grant_is_only_for_scheme_limited_staff_D1()
    {
        var s = await Agency();
        var johanId = await api.Person("johan@acacia.example", Roles.PortfolioManager, s.Org, [s.Kc]);
        var role = await api.Db(db => db.RoleAssignments.Where(a => a.UserId == johanId).SingleAsync());
        await s.Admin.StepUp();
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/access/identities/{johanId}/assignments/{role.Id}/browse-agency", new { allowed = true, expectedVersion = role.Version })).StatusCode);
        Assert.Contains("Portfolio.BrowseAgency", await api.Db(db => db.RoleAssignments.Where(a => a.Id == role.Id).Select(a => a.Grants).SingleAsync()));

        var orgWide = await api.Person("finance@acacia.example", Roles.Finance, s.Org);
        var financeRole = await api.Db(db => db.RoleAssignments.Where(a => a.UserId == orgWide).SingleAsync());
        var refused = await s.Admin.PostAsJsonAsync($"/api/access/identities/{orgWide}/assignments/{financeRole.Id}/browse-agency", new { allowed = true });
        Assert.Contains("Only staff roles limited", (await refused.FieldErrors()).GetProperty("assignmentId").GetString());
    }

    [Fact]
    public async Task Suspending_a_member_pauses_their_work_and_removing_ends_their_roles()
    {
        var s = await Agency();
        var johanId = await api.Person("johan@acacia.example", Roles.PortfolioManager, s.Org, [s.Kc]);
        var johan = await api.SignedIn("johan@acacia.example");
        await s.Admin.StepUp();

        Assert.True((await (await s.Admin.PostAsJsonAsync($"/api/access/identities/{johanId}/membership", new { organisationId = s.Org.ToString(), status = "suspended", reason = "ok" })).FieldErrors()).TryGetProperty("reason", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/access/identities/{johanId}/membership", new { organisationId = s.Org.ToString(), status = "suspended", reason = "On leave pending review" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await johan.GetAsync("/api/schemes")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/access/identities/{johanId}/membership", new { organisationId = s.Org.ToString(), status = "ended", reason = "Left the agency" })).StatusCode);
        Assert.All(await api.Db(db => db.RoleAssignments.Where(a => a.UserId == johanId).Select(a => a.Status).ToListAsync()), st => Assert.Equal(AssignmentStatuses.Ended, st));
    }

    [Fact]
    public async Task An_agency_sees_only_its_own_people_and_their_roles_there()
    {
        var s = await Agency();
        var marula = await api.Organisation("Marula");
        var both = await api.Person("shared@mail.example", Roles.Finance, s.Org);
        await api.Db(async db =>
        {
            db.Memberships.Add(new Humo.Infrastructure.Data.Membership { Id = Guid.NewGuid(), UserId = both, OrganisationId = marula, Since = DateTimeOffset.UtcNow });
            db.RoleAssignments.Add(new Humo.Infrastructure.Data.RoleAssignment { Id = Guid.NewGuid(), UserId = both, Role = Roles.AgencyAdmin, OrganisationId = marula, ScopeType = ScopeTypes.Organisation, Label = "Marula" });
            return await db.SaveChangesAsync();
        });
        await api.Person("marula-only@mail.example", Roles.Finance, marula);

        var directory = await (await s.Admin.GetAsync($"/api/access/directory?organisationId={marula}")).Json();
        var emails = directory.EnumerateArray().Select(i => i.GetProperty("email").GetString()).ToList();
        Assert.DoesNotContain("marula-only@mail.example", emails); // their own organisation, whatever they ask for
        var shared = directory.EnumerateArray().Single(i => i.GetProperty("email").GetString() == "shared@mail.example");
        Assert.All(shared.GetProperty("assignments").EnumerateArray(), a => Assert.Equal(s.Org.ToString(), a.GetProperty("scope").GetProperty("organisationId").GetString()));
    }

    [Fact]
    public async Task Humo_staff_suspend_an_organisation_after_step_up()
    {
        var org = await api.Organisation("Acacia");
        var humo = await api.SignedIn(HumoApiFactory.AdminEmail);
        await humo.StepUp();
        Assert.Equal(HttpStatusCode.NoContent, (await humo.PostAsJsonAsync($"/api/organisations/{org}/status", new { status = "suspended", reason = "Account unpaid for 90 days" })).StatusCode);

        // The proof lasts 5 minutes.
        api.Clock.Advance(TimeSpan.FromMinutes(6));
        var later = await humo.PostAsJsonAsync($"/api/organisations/{org}/status", new { status = "archived", reason = "Customer left Humo" });
        Assert.Equal("step-up-required", await later.ProblemCode());
    }
}
