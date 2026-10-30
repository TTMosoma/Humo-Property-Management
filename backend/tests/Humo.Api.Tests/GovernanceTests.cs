using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>
/// Governance on the API: a meeting's lifecycle (notice by email, quorum, resolutions and their actions, minutes approved
/// in My work), written resolutions decided by the trustees, and a budget approved by the AGM's resolution.
/// The test clock reads 19 October 2026.
/// </summary>
public sealed class GovernanceTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Org, Guid Kc, HttpClient Admin, Guid AdminId, List<Guid> Trustees);

    /// <summary>Kingfisher Court with two units, an owner on each, and three trustees on the board register (one signs in).</summary>
    private async Task<Setup> Scheme()
    {
        // Governance is in Enterprise.
        var org = await api.Customer("Acacia", "enterprise");
        var adminId = await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = Guid.Parse((await (await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" })).Json())
            .GetProperty("id").GetString()!);
        foreach (var (n, owner) in new[] { ("1", "Sipho"), ("2", "Lindiwe") })
        {
            var unit = Guid.Parse((await (await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = n, description = "2-bed", sizeM2 = 86, participationQuota = 50, monthlyLevy = 2000, occupancy = "owner-occupied" })).Json())
                .GetProperty("id").GetString()!);
            Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync("/api/people", new
            {
                details = new { firstName = owner, lastName = "Owner", kind = "individual", email = $"{owner.ToLowerInvariant()}@mail.example", phone = "082 555 0101", preferredChannel = "email" },
                link = new { type = "owner", schemeId = kc.ToString(), unitId = unit.ToString(), since = "2020-01-01" },
            })).StatusCode);
        }
        var trustees = await api.Db(async db =>
        {
            var ids = new List<Guid>();
            foreach (var (name, portfolio) in new[] { ("Bongani", "Chairperson"), ("Ayesha", "Treasurer"), ("Pieter", "Trustee") })
            {
                var p = new Person { Id = Guid.CreateVersion7(), OrganisationId = org, FirstName = name, LastName = "Trustee", DisplayName = $"{name} Trustee", Initials = name[..1] + "T",
                    Email = $"{name.ToLowerInvariant()}@trustee.example", CreatedAt = api.Clock.GetUtcNow() };
                db.People.Add(p);
                db.Relationships.Add(new Relationship { Id = Guid.CreateVersion7(), PersonId = p.Id, Type = "trustee", SchemeId = kc, Portfolio = portfolio, Since = new DateOnly(2025, 3, 1) });
                ids.Add(p.Id);
            }
            await db.SaveChangesAsync();
            return ids;
        });
        // Bongani signs in: trustee access to the scheme, linked to his person record.
        var bongani = await api.Person("bongani@trustee.example", Roles.Trustee, org, [kc]);
        await api.Db(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == bongani)).PersonId = trustees[0].ToString();
            return await db.SaveChangesAsync();
        });
        return new Setup(org, kc, admin, adminId, trustees);
    }

    private static async Task<string> Created(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return (await res.Json()).GetProperty("id").GetString()!;
    }

    private static async Task<JsonElement> Meeting(HttpClient c, string id) => await (await c.GetAsync($"/api/meetings/{id}")).Json();

    private static async Task<HttpResponseMessage> Act(HttpClient c, string id, object action) =>
        await c.PostAsJsonAsync($"/api/meetings/{id}/actions", new { action, expectedVersion = (await Meeting(c, id)).GetProperty("meeting").GetProperty("version").GetInt32() });

    private static async Task NoContent(HttpResponseMessage res) =>
        Assert.True(res.StatusCode == HttpStatusCode.NoContent, $"{res.StatusCode}: {await res.Content.ReadAsStringAsync()}");

    private string At(int days) => api.Clock.GetUtcNow().AddDays(days).ToString("O");

    [Fact]
    public async Task A_trustee_meeting_runs_from_notice_to_approved_minutes_with_its_actions_in_My_work()
    {
        var s = await Scheme();
        var id = await Created(await s.Admin.PostAsJsonAsync("/api/meetings", new { schemeId = s.Kc.ToString(), type = "trustee", scheduledFor = At(3), venue = "Clubhouse" }));
        var m = (await Meeting(s.Admin, id)).GetProperty("meeting");
        Assert.Equal(("MTG-KC-001", "draft", 3), (m.GetProperty("ref").GetString(), m.GetProperty("stage").GetString(), m.GetProperty("agenda").GetArrayLength()));
        // Three trustees who vote, and the managing agent who doesn't.
        Assert.Equal(3, m.GetProperty("attendees").EnumerateArray().Count(a => a.GetProperty("votes").GetBoolean()));

        // Seven days' notice: three days out is too soon.
        Assert.Contains("7 days’ notice", (await (await Act(s.Admin, id, new { type = "send-notice" })).FieldErrors()).GetProperty("scheduledFor").GetString());
        await NoContent(await Act(s.Admin, id, new { type = "reschedule", scheduledFor = At(10), venue = "Clubhouse" }));
        await NoContent(await Act(s.Admin, id, new { type = "send-notice" }));
        await HumoApiFactory.Until(() => api.Email.Sent.Count(x => x.Subject.StartsWith("Notice:")) == 3);
        Assert.Contains(api.Email.Sent, x => x.To == "ayesha@trustee.example" && x.Text.Contains("Clubhouse"));
        Assert.True((await (await Act(s.Admin, id, new { type = "add-agenda-item", title = "Late item" })).FieldErrors()).TryGetProperty("stage", out _));

        // Quorum: two of three trustees.
        var present = s.Trustees.Take(1).Select(t => t.ToString()).ToArray();
        Assert.Contains("Not quorate", (await (await Act(s.Admin, id, new { type = "record-attendance", presentIds = present })).FieldErrors()).GetProperty("presentIds").GetString());
        await NoContent(await Act(s.Admin, id, new { type = "record-attendance", presentIds = s.Trustees.Take(2).Select(t => t.ToString()).ToArray() }));

        // A resolution with an action: a task in My work, completed there.
        await NoContent(await Act(s.Admin, id, new
        {
            type = "add-resolution",
            resolution = new
            {
                title = "Repaint the stairwells", text = "The trustees resolve to repaint the stairwells before December.", outcome = "passed", votes = new { @for = 2, against = 0, abstain = 0 },
                actions = new[] { new { title = "Get three quotes", assigneeId = s.AdminId.ToString(), dueAt = At(14) } },
            },
        }));
        var detail = await Meeting(s.Admin, id);
        Assert.Equal(("minutes-draft", 1), (detail.GetProperty("meeting").GetProperty("stage").GetString(), detail.GetProperty("openActions").GetInt32()));
        var res = detail.GetProperty("resolutionViews")[0];
        Assert.Equal(("RES-KC-1", "in-progress"), (res.GetProperty("resolution").GetProperty("ref").GetString(), res.GetProperty("progress").GetString()));
        var task = await api.Db(db => db.WorkItems.Where(w => w.Type == "meeting-action").Select(w => w.Id).SingleAsync());
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync("/api/work-items/complete", new { ids = new[] { task.ToString() } })).StatusCode);
        var register = await (await s.Admin.GetAsync($"/api/resolutions?schemeIds={s.Kc}")).Json();
        Assert.Equal("completed", register.GetProperty("items")[0].GetProperty("progress").GetString());

        // The minutes go to the trustees in My work.
        await NoContent(await Act(s.Admin, id, new { type = "send-minutes-for-approval" }));
        var minutes = await api.Db(db => db.WorkItems.Where(w => w.Type == "minutes-approval").Select(w => w.Id).SingleAsync());
        var trustee = await api.SignedIn("bongani@trustee.example");
        await NoContent(await trustee.PostAsJsonAsync($"/api/work-items/{minutes}/decision", new { decision = "approved" }));
        Assert.Equal("minutes-approved", (await Meeting(s.Admin, id)).GetProperty("meeting").GetProperty("stage").GetString());
    }

    [Fact]
    public async Task A_written_resolution_is_decided_by_the_trustees_and_its_actions_start_when_it_passes()
    {
        var s = await Scheme();
        var reference = await Created(await s.Admin.PostAsJsonAsync("/api/resolutions/written", new
        {
            schemeId = s.Kc.ToString(), title = "Replace the gate motor", text = "The trustees resolve to replace the gate motor at a cost of up to R 18 000.",
            actions = new[] { new { title = "Order the motor", assigneeId = s.AdminId.ToString(), dueAt = At(7) } },
        }));
        Assert.Equal("RES-KC-1", reference);
        Assert.Equal(0, await api.Db(db => db.WorkItems.CountAsync(w => w.Type == "meeting-action")));
        var approval = await api.Db(db => db.WorkItems.Where(w => w.Type == "resolution-approval").Select(w => w.Id).SingleAsync());
        var trustee = await api.SignedIn("bongani@trustee.example");
        await NoContent(await trustee.PostAsJsonAsync($"/api/work-items/{approval}/decision", new { decision = "approved" }));
        var view = (await (await s.Admin.GetAsync($"/api/resolutions?schemeIds={s.Kc}")).Json()).GetProperty("items")[0];
        Assert.Equal(("passed", "in-progress"), (view.GetProperty("resolution").GetProperty("outcome").GetString(), view.GetProperty("progress").GetString()));
        Assert.Equal(1, await api.Db(db => db.WorkItems.CountAsync(w => w.Type == "meeting-action")));
        var assignees = (await (await s.Admin.GetAsync($"/api/resolutions/assignees?schemeIds={s.Kc}")).Json()).EnumerateArray().Select(a => a.GetProperty("kind").GetString()).ToList();
        Assert.Equal(["staff", "trustee"], assignees);
    }

    [Fact]
    public async Task A_budget_put_to_the_AGM_is_approved_by_the_resolution_on_its_agenda_item_and_owners_get_the_notice()
    {
        var s = await Scheme();
        var budget = Guid.Parse(await Created(await s.Admin.PostAsJsonAsync("/api/budgets", new { schemeId = s.Kc.ToString(), year = "next", increasePct = 5, financialYearEnd = 2 })));
        var agm = await Created(await s.Admin.PostAsJsonAsync("/api/meetings", new { schemeId = s.Kc.ToString(), type = "agm", scheduledFor = At(20), venue = "Clubhouse" }));
        var version = (await (await s.Admin.GetAsync($"/api/budgets/{budget}")).Json()).GetProperty("budget").GetProperty("version").GetInt32();
        await NoContent(await s.Admin.PostAsJsonAsync($"/api/budgets/{budget}/actions", new { action = new { type = "propose", meetingId = agm }, expectedVersion = version }));
        var b = (await (await s.Admin.GetAsync($"/api/budgets/{budget}")).Json()).GetProperty("budget");
        Assert.Equal("proposed", b.GetProperty("status").GetString());
        var itemId = b.GetProperty("agm").GetProperty("agendaItemId").GetString();
        // It uses the AGM's standard budget item.
        Assert.Contains("Budget and levies", (await Meeting(s.Admin, agm)).GetProperty("meeting").GetProperty("agenda").EnumerateArray().Single(a => a.GetProperty("id").GetString() == itemId).GetProperty("title").GetString());

        await NoContent(await Act(s.Admin, agm, new { type = "send-notice" }));
        await HumoApiFactory.Until(() => api.Email.Sent.Count(x => x.Subject.StartsWith("Notice:")) == 2);
        Assert.Contains(api.Email.Sent, x => x.To == "sipho@mail.example" && x.Text.Contains("proxy"));
        // A general meeting's quorum is a third of the units: one of two.
        await NoContent(await Act(s.Admin, agm, new { type = "record-attendance", presentIds = Array.Empty<string>(), ownersPresent = 1 }));
        await NoContent(await Act(s.Admin, agm, new
        {
            type = "add-resolution",
            resolution = new { title = "Approve the budget", text = "The owners approve the budget for the coming year.", agendaItemId = itemId, outcome = "passed", votes = new { @for = 1, against = 0, abstain = 0 }, actions = Array.Empty<object>() },
        }));
        b = (await (await s.Admin.GetAsync($"/api/budgets/{budget}")).Json()).GetProperty("budget");
        Assert.Equal(("approved", "RES-KC-1", agm), (b.GetProperty("status").GetString(), b.GetProperty("approved").GetProperty("resolutionRef").GetString(), b.GetProperty("approved").GetProperty("meetingId").GetString()));
    }
}
