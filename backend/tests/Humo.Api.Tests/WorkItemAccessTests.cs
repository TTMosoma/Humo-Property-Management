using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>D32: the API sends each role only its own work, and a rule breach stays with those who enforce the rules.</summary>
public sealed class WorkItemAccessTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Org, HttpClient Admin, Guid AdminId, HttpClient Finance, Guid FinanceId, HttpClient Pm, Guid PmId);

    private async Task<Setup> Team()
    {
        var org = await api.Customer("Acacia");
        var adminId = await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var financeId = await api.Person("priya@acacia.example", Roles.Finance, org);
        var pmId = await api.Person("johan@acacia.example", Roles.PortfolioManager, org);
        return new Setup(org, await api.SignedIn("thandeka@acacia.example"), adminId, await api.SignedIn("priya@acacia.example"), financeId, await api.SignedIn("johan@acacia.example"), pmId);
    }

    private Task<Guid> Work(Setup s, string type, Guid? assignee = null, string kind = "task", string approvers = "[]") => api.Db(async db =>
    {
        var row = new WorkItemRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = s.Org, Ref = $"T-{Guid.NewGuid().ToString()[..4]}", Kind = kind, Type = type, Title = type, Detail = "",
            CreatedAt = api.Clock.GetUtcNow(), DueAt = api.Clock.GetUtcNow().AddDays(2), AssigneeId = assignee?.ToString(), ApproverRoles = approvers, Evidence = "[]", Route = "/tasks",
        };
        db.WorkItems.Add(row);
        await db.SaveChangesAsync();
        return row.Id;
    });

    private static async Task<List<string>> TypesFor(HttpClient c) =>
        [.. (await (await c.GetAsync("/api/work-items")).Json()).EnumerateArray().Select(w => w.GetProperty("type").GetString()!).Order()];

    private Task<string?> AssigneeOf(Guid item) => api.Db(db => db.WorkItems.Where(w => w.Id == item).Select(w => w.AssigneeId).SingleAsync());

    private string Day(int days) => DateOnly.FromDateTime(api.Clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).DateTime).AddDays(days).ToString("yyyy-MM-dd");

    [Fact]
    public async Task Each_role_is_sent_only_its_own_work()
    {
        var s = await Team();
        await Work(s, "receipt-allocation");
        await Work(s, "maintenance-triage");
        await Work(s, "follow-up");
        await Work(s, "rule-breach", s.PmId);
        await Work(s, "bank-details-verification", kind: "approval", approvers: """["agency-admin","finance"]""");

        Assert.Equal(["bank-details-verification", "receipt-allocation"], await TypesFor(s.Finance));
        Assert.Equal(["follow-up", "maintenance-triage", "rule-breach"], await TypesFor(s.Pm));
        Assert.Equal(5, (await TypesFor(s.Admin)).Count);
    }

    [Fact]
    public async Task Work_assigned_to_finance_reaches_them_unless_it_is_a_rule_breach()
    {
        var s = await Team();
        await Work(s, "follow-up", s.FinanceId);
        await Work(s, "rule-breach", s.FinanceId);

        Assert.Equal(["follow-up"], await TypesFor(s.Finance));
    }

    [Fact]
    public async Task Finance_cannot_change_a_breach_task_by_calling_the_API()
    {
        var s = await Team();
        var task = await Work(s, "rule-breach", s.PmId);

        var refused = await s.Finance.PostAsJsonAsync("/api/work-items/complete", new { ids = new[] { task.ToString() } });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
    }

    [Fact]
    public async Task A_breach_task_cannot_be_assigned_to_finance()
    {
        var s = await Team();
        var task = await Work(s, "rule-breach", s.PmId);

        var refused = await s.Admin.PostAsJsonAsync("/api/work-items/assign", new { ids = new[] { task.ToString() }, assigneeId = s.FinanceId.ToString() });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
        Assert.Equal(s.PmId.ToString(), await AssigneeOf(task));

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync("/api/work-items/assign", new { ids = new[] { task.ToString() }, assigneeId = s.AdminId.ToString() })).StatusCode);
    }

    [Fact]
    public async Task When_finance_covers_a_manager_the_administrator_takes_the_breaches_and_they_go_back_afterwards()
    {
        var s = await Team();
        var breach = await Work(s, "rule-breach", s.PmId);
        var other = await Work(s, "follow-up", s.PmId);

        var cover = await s.Pm.PutAsJsonAsync($"/api/staff/{s.PmId}/cover", new { coverId = s.FinanceId.ToString(), from = Day(0), to = Day(4), reason = "Annual leave" });
        Assert.Equal(HttpStatusCode.NoContent, cover.StatusCode);
        Assert.Equal(s.AdminId.ToString(), await AssigneeOf(breach));
        Assert.Equal(s.FinanceId.ToString(), await AssigneeOf(other));

        Assert.Equal(HttpStatusCode.NoContent, (await s.Pm.DeleteAsync($"/api/staff/{s.PmId}/cover")).StatusCode);
        Assert.Equal(s.PmId.ToString(), await AssigneeOf(breach));
        Assert.Equal(s.PmId.ToString(), await AssigneeOf(other));
    }

    [Fact]
    public async Task A_colleagues_page_doesnt_show_finance_their_breach_tasks()
    {
        var s = await Team();
        await Work(s, "rule-breach", s.PmId);
        await Work(s, "follow-up", s.PmId);

        static async Task<int> OpenOn(HttpClient c, Guid staff) => (await (await c.GetAsync($"/api/staff/{staff}")).Json()).GetProperty("openWork").GetArrayLength();
        Assert.Equal(2, await OpenOn(s.Admin, s.PmId));
        Assert.Equal(0, await OpenOn(s.Finance, s.PmId));
    }
}
