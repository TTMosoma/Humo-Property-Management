using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Api.Work;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Api.Tests;

/// <summary>Staff on the API: the team with its workload from My work, and away cover that moves open work and back.</summary>
public sealed class StaffTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Org, HttpClient Admin, Guid AdminId, HttpClient Finance, Guid FinanceId, HttpClient Pm, Guid PmId);

    private async Task<Setup> Team()
    {
        var org = await api.Customer("Acacia");
        var adminId = await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var financeId = await api.Person("priya@acacia.example", Roles.Finance, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = Guid.Parse((await (await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" })).Json())
            .GetProperty("id").GetString()!);
        var pmId = await api.Person("johan@acacia.example", Roles.PortfolioManager, org, [kc]);
        await api.Person("bongani@trustee.example", Roles.Trustee, org, [kc]);
        return new Setup(org, admin, adminId, await api.SignedIn("priya@acacia.example"), financeId, await api.SignedIn("johan@acacia.example"), pmId);
    }

    private Task<Guid> Work(Setup s, Guid assignee, string kind = "task") => api.Db(async db =>
    {
        var row = new WorkItemRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = s.Org, Ref = $"T-{Guid.NewGuid().ToString()[..4]}", Kind = kind, Type = kind == "message" ? "owner-message" : "follow-up",
            Title = "Call the owner back", Detail = "", CreatedAt = api.Clock.GetUtcNow(), DueAt = api.Clock.GetUtcNow().AddDays(-1), AssigneeId = assignee.ToString(),
            ApproverRoles = "[]", Evidence = "[]", Route = "/tasks",
        };
        db.WorkItems.Add(row);
        await db.SaveChangesAsync();
        return row.Id;
    });

    private Task<string?> AssigneeOf(Guid item) => api.Db(db => db.WorkItems.Where(w => w.Id == item).Select(w => w.AssigneeId).SingleAsync());

    private string Day(int days) => DateOnly.FromDateTime(api.Clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).DateTime).AddDays(days).ToString("yyyy-MM-dd");

    private async Task Sweep()
    {
        using var scope = api.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<StaffCovers>().SweepAsync(CancellationToken.None);
    }

    private static Task<HttpResponseMessage> Cover(HttpClient c, Guid staff, Guid cover, string from, string to, string reason = "Annual leave") =>
        c.PutAsJsonAsync($"/api/staff/{staff}/cover", new { coverId = cover.ToString(), from, to, reason });

    [Fact]
    public async Task The_team_shows_each_persons_schemes_and_workload()
    {
        var s = await Team();
        await Work(s, s.FinanceId);
        await Work(s, s.FinanceId, "message");

        var team = (await (await s.Admin.GetAsync("/api/staff")).Json()).EnumerateArray().ToList();
        // Staff only: the trustee isn't on the team.
        Assert.Equal(new[] { s.AdminId, s.FinanceId, s.PmId }.Select(g => g.ToString()).Order(), team.Select(x => x.GetProperty("id").GetString()!).Order());
        var priya = team.Single(t => t.GetProperty("id").GetString() == s.FinanceId.ToString());
        Assert.Equal((1, 1, 1, true), (priya.GetProperty("openTasks").GetInt32(), priya.GetProperty("overdueTasks").GetInt32(), priya.GetProperty("openMessages").GetInt32(),
            priya.GetProperty("allSchemes").GetBoolean()));
        var johan = team.Single(t => t.GetProperty("id").GetString() == s.PmId.ToString());
        Assert.Equal((false, "KC"), (johan.GetProperty("allSchemes").GetBoolean(), johan.GetProperty("schemes")[0].GetProperty("code").GetString()));

        var detail = await (await s.Admin.GetAsync($"/api/staff/{s.FinanceId}")).Json();
        Assert.Equal(2, detail.GetProperty("openWork").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await s.Admin.GetAsync($"/api/staff/{Guid.NewGuid()}")).StatusCode);
    }

    [Fact]
    public async Task Away_cover_moves_open_work_and_new_work_to_a_colleague_and_back()
    {
        var s = await Team();
        var task = await Work(s, s.FinanceId);
        var approval = await api.Db(async db =>
        {
            var row = new WorkItemRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = s.Org, Ref = "BR-1", Kind = "approval", Type = "billing-run-approval", Title = "Billing", Detail = "", CreatedAt = api.Clock.GetUtcNow(),
                DueAt = api.Clock.GetUtcNow(), AssigneeId = s.FinanceId.ToString(), ApproverRoles = "[\"finance\"]", Evidence = "[]", Route = "/",
            };
            db.WorkItems.Add(row);
            await db.SaveChangesAsync();
            return row.Id;
        });

        // Priya sets her own cover: her tasks go to Thandeka; approvals stay, they're decided by role.
        await NoContent(await Cover(s.Finance, s.FinanceId, s.AdminId, Day(0), Day(4)));
        Assert.Equal(s.AdminId.ToString(), await AssigneeOf(task));
        Assert.Equal(s.FinanceId.ToString(), await AssigneeOf(approval));
        var priya = (await (await s.Admin.GetAsync("/api/staff")).Json()).EnumerateArray().Single(t => t.GetProperty("id").GetString() == s.FinanceId.ToString());
        Assert.Equal(s.AdminId.ToString(), priya.GetProperty("away").GetProperty("coverId").GetString());
        var thandeka = (await (await s.Admin.GetAsync("/api/staff")).Json()).EnumerateArray().Single(t => t.GetProperty("id").GetString() == s.AdminId.ToString());
        Assert.Equal(1, thandeka.GetProperty("covering").GetArrayLength());

        // New work assigned to her while she's away goes to the cover too.
        var later = await Work(s, s.FinanceId);
        await Sweep();
        Assert.Equal(s.AdminId.ToString(), await AssigneeOf(later));

        // Back early: what's still open moves back.
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.DeleteAsync($"/api/staff/{s.FinanceId}/cover")).StatusCode);
        Assert.Equal((s.FinanceId.ToString(), s.FinanceId.ToString()), (await AssigneeOf(task), await AssigneeOf(later)));
        Assert.True(await api.Db(db => db.Audit.AnyAsync(e => e.Action.StartsWith("Ended away cover for"))));
    }

    [Fact]
    public async Task A_cover_to_come_starts_and_ends_by_itself()
    {
        var s = await Team();
        var task = await Work(s, s.FinanceId);
        await NoContent(await Cover(s.Admin, s.FinanceId, s.PmId, Day(2), Day(3), "Training"));
        Assert.Equal(s.FinanceId.ToString(), await AssigneeOf(task));
        api.Clock.Advance(TimeSpan.FromDays(2));
        await Sweep();
        Assert.Equal(s.PmId.ToString(), await AssigneeOf(task));
        api.Clock.Advance(TimeSpan.FromDays(2));
        await Sweep();
        Assert.Equal(s.FinanceId.ToString(), await AssigneeOf(task));
        Assert.True(await api.Db(db => db.StaffCovers.AllAsync(c => c.EndedAt != null)));
    }

    [Fact]
    public async Task Only_an_administrator_sets_someone_elses_cover_and_the_dates_must_make_sense()
    {
        var s = await Team();
        var errors = await (await Cover(s.Pm, s.FinanceId, s.PmId, Day(0), Day(1))).FieldErrors();
        Assert.True(errors.TryGetProperty("staffId", out _));
        Assert.True((await (await Cover(s.Finance, s.FinanceId, s.FinanceId, Day(0), Day(1))).FieldErrors()).TryGetProperty("coverId", out _));
        Assert.True((await (await Cover(s.Finance, s.FinanceId, s.AdminId, Day(3), Day(1))).FieldErrors()).TryGetProperty("to", out _));
        Assert.True((await (await Cover(s.Finance, s.FinanceId, s.AdminId, Day(-5), Day(-1))).FieldErrors()).TryGetProperty("to", out _));
        // Someone who's away can't cover.
        await NoContent(await Cover(s.Admin, s.AdminId, s.PmId, Day(0), Day(2)));
        Assert.Contains("away too", (await (await Cover(s.Finance, s.FinanceId, s.AdminId, Day(0), Day(1))).FieldErrors()).GetProperty("coverId").GetString());
    }

    private static async Task NoContent(HttpResponseMessage res) =>
        Assert.True(res.StatusCode == HttpStatusCode.NoContent, $"{res.StatusCode}: {await res.Content.ReadAsStringAsync()}");
}
