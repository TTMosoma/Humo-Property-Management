using System.Net;
using System.Net.Http.Json;
using Humo.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Impersonation, the audit log and the person's own security settings (doc 24 §8).</summary>
public sealed class ImpersonationAndAuditTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private record Setup(Guid Org, Guid Thandeka, Guid Assignment, HttpClient Humo);

    /// <summary>A customer administrator, and a System Administrator allowed to impersonate.</summary>
    private async Task<Setup> Scene(bool grant = true)
    {
        var org = await api.Organisation("Acacia");
        var thandeka = await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var assignment = await api.Db(db => db.RoleAssignments.Where(a => a.UserId == thandeka).Select(a => a.Id).SingleAsync());
        if (grant)
            await api.Db(async db =>
            {
                var admin = await db.RoleAssignments.Where(a => a.Role == Roles.SystemAdmin).SingleAsync();
                admin.Grants = ["System.Impersonate"];
                return await db.SaveChangesAsync();
            });
        return new Setup(org, thandeka, assignment, await api.SignedIn(HumoApiFactory.AdminEmail));
    }

    private static object Start(Setup s, string mode) => new { targetId = s.Thandeka.ToString(), targetAssignmentId = s.Assignment.ToString(), mode, reason = "support", ticket = "HD-1042" };

    [Fact]
    public async Task Observe_shows_the_customer_s_app_but_changes_nothing()
    {
        var s = await Scene();
        Assert.Equal(HttpStatusCode.OK, (await s.Humo.PostAsJsonAsync("/api/me/impersonation", Start(s, "observe"))).StatusCode);

        var me = await (await s.Humo.GetAsync("/api/me")).Json();
        Assert.Equal("thandeka@acacia.example", me.GetProperty("identity").GetProperty("email").GetString());
        Assert.Equal(HumoApiFactory.AdminEmail, me.GetProperty("actor").GetProperty("email").GetString());
        Assert.Equal("observe", me.GetProperty("impersonation").GetProperty("mode").GetString());
        Assert.DoesNotContain("Schemes.Manage", me.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()));
        Assert.Contains("Schemes.Manage", me.GetProperty("pagePermissions").EnumerateArray().Select(p => p.GetString()));

        // Reads are the customer's; any change is refused as observe-only and audited.
        Assert.Equal(HttpStatusCode.OK, (await s.Humo.GetAsync("/api/schemes")).StatusCode);
        var write = await s.Humo.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" });
        Assert.Equal("observe-only", await write.ProblemCode());
        var denied = await api.Db(db => db.Audit.Where(a => a.Result == "denied").OrderBy(a => a.Id).LastAsync());
        Assert.Equal("Ayanda Admin", denied.ActorName);
        Assert.Equal("thandeka", denied.ActingAsName);
        Assert.Equal("observe", denied.ImpersonationMode);
    }

    [Fact]
    public async Task Act_needs_a_fresh_step_up_then_acts_as_the_customer_audited_as_the_staff_member()
    {
        var s = await Scene();
        Assert.Equal("step-up-required", await (await s.Humo.PostAsJsonAsync("/api/me/impersonation", Start(s, "act"))).ProblemCode());
        await s.Humo.StepUp();
        Assert.Equal(HttpStatusCode.OK, (await s.Humo.PostAsJsonAsync("/api/me/impersonation", Start(s, "act"))).StatusCode);

        var created = await s.Humo.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var entry = await api.Db(db => db.Audit.Where(a => a.Action == "Added scheme Kingfisher Court").SingleAsync());
        Assert.Equal("Ayanda Admin", entry.ActorName);
        Assert.Equal(s.Thandeka, entry.ActingAsId);
        Assert.Equal("act", entry.ImpersonationMode);
        Assert.Equal("HD-1042", entry.ImpersonationNote);

        // Ending always works, is audited with its duration, and the app is Humo's again.
        api.Clock.Advance(TimeSpan.FromMinutes(7));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Humo.PostAsync("/api/me/impersonation/end", null)).StatusCode);
        var actions = await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync());
        Assert.True(actions.Contains("Ended impersonation (7 min)"), string.Join(" | ", actions));
        var me = await (await s.Humo.GetAsync("/api/me")).Json();
        Assert.Equal(JsonValueKindNull, me.GetProperty("impersonation").ValueKind);
    }

    private const System.Text.Json.JsonValueKind JsonValueKindNull = System.Text.Json.JsonValueKind.Null;

    [Fact]
    public async Task Only_with_the_individual_grant_and_never_Humo_staff()
    {
        var s = await Scene(grant: false);
        var refused = await s.Humo.PostAsJsonAsync("/api/me/impersonation", Start(s, "observe"));
        Assert.Equal("forbidden", await refused.ProblemCode());
        Assert.Contains("System.Impersonate not granted", await api.Db(db => db.Audit.Where(a => a.Action == "Tried to start impersonation").Select(a => a.Reason).ToListAsync()));

        await api.Db(async db =>
        {
            var admin = await db.RoleAssignments.Where(a => a.Role == Roles.SystemAdmin).SingleAsync();
            admin.Grants = ["System.Impersonate"];
            return await db.SaveChangesAsync();
        });
        var t = s;
        var support = await api.Person("lerato@humo.co.za", Roles.Support, null);
        var supportRole = await api.Db(db => db.RoleAssignments.Where(a => a.UserId == support).Select(a => a.Id).SingleAsync());
        var humoTarget = await t.Humo.PostAsJsonAsync("/api/me/impersonation", new { targetId = support.ToString(), targetAssignmentId = supportRole.ToString(), mode = "observe", reason = "support" });
        Assert.Equal("forbidden", await humoTarget.ProblemCode());
    }

    [Fact]
    public async Task Signing_out_ends_the_impersonation()
    {
        var s = await Scene();
        await s.Humo.PostAsJsonAsync("/api/me/impersonation", Start(s, "observe"));
        await s.Humo.PostAsync("/api/auth/sign-out", null);
        Assert.True(await api.Db(db => db.ImpersonationSessions.AllAsync(x => x.EndedAt != null)));
    }

    [Fact]
    public async Task An_agency_reads_its_own_audit_and_Humo_reads_everything()
    {
        var s = await Scene();
        var agency = await api.SignedIn("thandeka@acacia.example");
        await agency.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" });

        var own = await (await agency.GetAsync($"/api/audit?organisationId={Guid.NewGuid()}")).Json();
        Assert.All(own.GetProperty("items").EnumerateArray(), e => Assert.Equal(s.Org.ToString(), e.GetProperty("organisationId").GetString()));
        Assert.Contains(own.GetProperty("items").EnumerateArray(), e => e.GetProperty("action").GetString() == "Added scheme Kingfisher Court");

        var all = await (await s.Humo.GetAsync("/api/audit")).Json();
        Assert.True(all.GetProperty("total").GetInt32() > own.GetProperty("total").GetInt32());

        // Exporting needs step-up, returns a CSV, and is itself audited.
        Assert.Equal("step-up-required", await (await s.Humo.PostAsJsonAsync("/api/audit/export", new { organisationId = (string?)null })).ProblemCode());
        await s.Humo.StepUp();
        var export = await s.Humo.PostAsJsonAsync("/api/audit/export", new { organisationId = (string?)null });
        Assert.Equal("text/csv", export.Content.Headers.ContentType?.MediaType);
        Assert.Contains("Added scheme Kingfisher Court", await export.Content.ReadAsStringAsync());
        Assert.Contains(await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync()), a => a.StartsWith("Exported the audit log"));
    }

    [Fact]
    public async Task People_without_audit_permissions_can_t_read_it()
    {
        var s = await Scene();
        await api.Person("finance@acacia.example", Roles.Finance, s.Org);
        var finance = await api.SignedIn("finance@acacia.example");
        Assert.Equal("forbidden", await (await finance.GetAsync("/api/audit")).ProblemCode());
    }

    [Fact]
    public async Task The_security_page_lists_this_session_and_keeps_the_last_passkey()
    {
        var s = await Scene();
        var profile = await (await s.Humo.GetAsync("/api/me/security")).Json();
        Assert.Empty(profile.GetProperty("passkeys").EnumerateArray());
        Assert.True(profile.GetProperty("sessions")[0].GetProperty("current").GetBoolean());

        await s.Humo.StepUp();
        Assert.Equal(HttpStatusCode.NoContent, (await s.Humo.PostAsync("/api/me/security/sign-out-others", null)).StatusCode);
        // This session carries on.
        Assert.Equal(HttpStatusCode.OK, (await s.Humo.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task The_chosen_role_survives_the_five_minute_session_refresh()
    {
        var org = await api.Organisation("Acacia");
        var sarah = await api.Person("sarah@acacia.example", Roles.PortfolioManager, org);
        var finance = await api.Db(async db =>
        {
            var a = new Humo.Infrastructure.Data.RoleAssignment { Id = Guid.CreateVersion7(), UserId = sarah, Role = Roles.Finance, OrganisationId = org, ScopeType = ScopeTypes.Organisation, Label = "Acacia", GrantedAt = DateTimeOffset.UtcNow.AddDays(1) };
            db.RoleAssignments.Add(a);
            await db.SaveChangesAsync();
            return a.Id;
        });
        var client = await api.SignedIn("sarah@acacia.example");
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/me/assignment", new { assignmentId = finance.ToString() })).StatusCode);

        api.Clock.Advance(TimeSpan.FromMinutes(6));
        var me = await (await client.GetAsync("/api/me")).Json();
        Assert.Equal(finance.ToString(), me.GetProperty("activeAssignmentId").GetString());
    }
}
