using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Every task or approval that lands on someone is in their bell too.</summary>
public sealed class WorkNoticeTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Org, Guid Kc, HttpClient Admin, Guid AdminId, HttpClient Finance, Guid FinanceId, HttpClient Pm, Guid PmId, HttpClient Owner);

    private async Task<Setup> Agency(bool withPm = true)
    {
        var org = await api.Customer("Acacia");
        var adminId = await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var financeId = await api.Person("priya@acacia.example", Roles.Finance, org);
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var u42 = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "42", description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1800, occupancy = "owner-occupied" }));
        await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Sipho", lastName = "Khumalo", kind = "individual", email = "sipho@mail.example", phone = "083 551 0274", preferredChannel = "email" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = u42.ToString(), since = "2019-05-01" },
        }));
        var owner = await api.Person("sipho@mail.example", Roles.Owner, org, [kc]);
        await api.Db(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == owner)).PersonId = (await db.People.SingleAsync(p => p.Email == "sipho@mail.example")).Id.ToString();
            return await db.SaveChangesAsync();
        });
        var pmId = withPm ? await api.Person("johan@acacia.example", Roles.PortfolioManager, org, [kc]) : Guid.Empty;
        return new Setup(org, kc, admin, adminId, await api.SignedIn("priya@acacia.example"), financeId,
            withPm ? await api.SignedIn("johan@acacia.example") : admin, pmId, await api.SignedIn("sipho@mail.example"));
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static async Task<List<JsonElement>> Bell(HttpClient c) => [.. (await (await c.GetAsync("/api/notifications")).Json()).EnumerateArray()];

    private static async Task<List<string>> Titles(HttpClient c) => [.. (await Bell(c)).Select(n => n.GetProperty("title").GetString()!)];

    private Task<Guid> Task(Setup s, string type) => api.Db(async db =>
    {
        var row = new WorkItemRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = s.Org, SchemeId = s.Kc, Ref = $"T-{Guid.NewGuid().ToString()[..4]}", Kind = "task", Type = type, Title = $"Do the {type}", Detail = "",
            CreatedAt = api.Clock.GetUtcNow(), DueAt = api.Clock.GetUtcNow().AddDays(2), ApproverRoles = "[]", Evidence = "[]", Route = "/tasks",
        };
        db.WorkItems.Add(row);
        await db.SaveChangesAsync();
        return row.Id;
    });

    [Fact]
    public async Task A_residents_report_reaches_the_schemes_portfolio_manager()
    {
        var s = await Agency();

        Assert.Equal(HttpStatusCode.Created, (await s.Owner.PostAsJsonAsync("/api/jobs", new { title = "Geyser leaking", description = "Dripping since this morning.", category = "Plumbing" })).StatusCode);

        var notice = Assert.Single(await Bell(s.Pm), n => n.GetProperty("title").GetString()!.StartsWith("New task:", StringComparison.Ordinal));
        // Not "New task: New: Geyser leaking": the triage task's own "New:" is left off.
        Assert.Equal("New task: Geyser leaking", notice.GetProperty("title").GetString());
        Assert.Equal("maintenance", notice.GetProperty("kind").GetString());
        Assert.Contains("Kingfisher Court", notice.GetProperty("detail").GetString());
        // The administrators see every task in My work, but the portfolio manager is the one who acts on it.
        Assert.DoesNotContain(await Titles(s.Admin), t => t.StartsWith("New task:", StringComparison.Ordinal));
        Assert.DoesNotContain(await Titles(s.Finance), t => t.StartsWith("New task:", StringComparison.Ordinal));
        // In the app only: no new email about it.
        Assert.DoesNotContain(api.Email.Sent, m => m.Subject.StartsWith("New task:", StringComparison.Ordinal));
    }

    [Fact]
    public async Task With_no_portfolio_manager_the_administrators_hear_about_it()
    {
        var s = await Agency(withPm: false);

        Assert.Equal(HttpStatusCode.Created, (await s.Owner.PostAsJsonAsync("/api/jobs", new { title = "Geyser leaking", description = "Dripping since this morning.", category = "Plumbing" })).StatusCode);

        Assert.Contains(await Titles(s.Admin), t => t.StartsWith("New task:", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Work_assigned_to_someone_is_in_their_bell_and_not_the_assigners()
    {
        var s = await Agency();
        var task = await Task(s, "follow-up");

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync("/api/work-items/assign", new { ids = new[] { task.ToString() }, assigneeId = s.FinanceId.ToString() })).StatusCode);

        var notice = Assert.Single(await Bell(s.Finance));
        Assert.Equal("Assigned to you: Do the follow-up", notice.GetProperty("title").GetString());
        Assert.Equal("/tasks", notice.GetProperty("link").GetString());
        Assert.Empty(await Bell(s.Admin));
    }

    [Fact]
    public async Task Several_items_moved_at_once_arrive_as_one_notice()
    {
        var s = await Agency();
        var a = await Task(s, "follow-up");
        var b = await Task(s, "follow-up");
        var c = await Task(s, "follow-up");

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync("/api/work-items/assign", new { ids = new[] { a.ToString(), b.ToString(), c.ToString() }, assigneeId = s.PmId.ToString() })).StatusCode);

        var notice = Assert.Single(await Bell(s.Pm));
        Assert.Equal("3 tasks assigned to you", notice.GetProperty("title").GetString());
    }

    [Fact]
    public async Task An_approval_reaches_the_people_who_can_decide_it()
    {
        var s = await Agency();
        var supplier = await Id(await s.Admin.PostAsJsonAsync("/api/suppliers", new
        {
            name = "GreenLeaf Gardens", trades = new[] { "Gardens" }, contactName = "Precious Mabaso", phone = "082 555 0142", email = "accounts@greenleaf.example", schemeIds = new[] { s.Kc.ToString() },
        }));

        await s.Admin.StepUp();
        var entered = await s.Admin.PostAsJsonAsync($"/api/suppliers/{supplier}/bank-details", new { bankName = "FNB", branchCode = "250655", accountNumber = "62012345678", accountType = "cheque", accountHolder = "GreenLeaf Gardens (Pty) Ltd" });
        Assert.True(entered.IsSuccessStatusCode, await entered.Content.ReadAsStringAsync());

        var notice = Assert.Single(await Bell(s.Finance), n => n.GetProperty("title").GetString()!.StartsWith("To approve:", StringComparison.Ordinal));
        Assert.Equal("finance", notice.GetProperty("kind").GetString());
        // Whoever entered the details can't verify them, so they aren't asked to.
        Assert.DoesNotContain(await Titles(s.Admin), t => t.StartsWith("To approve:", StringComparison.Ordinal));
        // Bank details aren't for portfolio managers (D32).
        Assert.DoesNotContain(await Titles(s.Pm), t => t.StartsWith("To approve:", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Finishing_a_task_tells_nobody()
    {
        var s = await Agency();
        var task = await Task(s, "follow-up");
        await api.Db(async db =>
        {
            (await db.WorkItems.SingleAsync(w => w.Id == task)).AssigneeId = s.PmId.ToString();
            return await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.NoContent, (await s.Pm.PostAsJsonAsync("/api/work-items/complete", new { ids = new[] { task.ToString() } })).StatusCode);

        Assert.Empty(await Bell(s.Admin));
        Assert.Empty(await Bell(s.Pm));
    }
}
