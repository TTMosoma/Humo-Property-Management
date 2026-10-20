using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>The Inbox on the API, and read receipts from the resident portal (docs/18 R-5).</summary>
public sealed class InboxTests : IDisposable
{
    private readonly HumoApiFactory api = new HumoApiFactory().With("Sms:Provider", "Captured");

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Kc, HttpClient Admin, HttpClient Owner);

    /// <summary>Kingfisher Court, unit 42: Sipho Khumalo, who signs in to the resident portal.</summary>
    private async Task<Setup> Scheme()
    {
        var org = await api.Customer("Acacia", "professional");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var u42 = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "42", description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1800, occupancy = "owner-occupied" }));
        await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Sipho", lastName = "Khumalo", kind = "individual", email = "sipho@mail.example", phone = "083 551 0274", preferredChannel = "email" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = u42.ToString(), since = "2019-05-01" },
        }));
        var user = await api.Person("sipho@mail.example", Roles.Owner, org, [kc]);
        await api.Db(async db =>
        {
            var person = await db.People.SingleAsync(p => p.Email == "sipho@mail.example");
            (await db.Users.SingleAsync(u => u.Id == user)).PersonId = person.Id.ToString();
            return await db.SaveChangesAsync();
        });
        return new Setup(kc, admin, await api.SignedIn("sipho@mail.example"));
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.OK, await res.Content.ReadAsStringAsync());
        return await res.Json();
    }

    private static Task<HttpResponseMessage> Act(HttpClient c, Guid id, object action, int version) =>
        c.PostAsJsonAsync($"/api/inbox/{id}/actions", new { action, expectedVersion = version });

    private Task<string?> WorkStatus(Guid conversation, string type) =>
        api.Db(async db => (await db.WorkItems.Where(w => w.SourceId == conversation && w.Type == type).Select(w => w.Status).ToListAsync()) is var all && all.Contains("open") ? "open" : all.FirstOrDefault());

    [Fact]
    public async Task A_resident_writes_from_the_portal_and_the_reply_comes_back_there_and_shows_as_read()
    {
        var s = await Scheme();
        Assert.True((await (await s.Owner.PostAsJsonAsync("/api/me/conversations", new { subject = "", body = "Hello" })).FieldErrors()).TryGetProperty("subject", out _));
        var id = await Id(await s.Owner.PostAsJsonAsync("/api/me/conversations", new { subject = "Leaking geyser", body = "Water is coming through my ceiling from the unit above." }));

        // In the Inbox with the person's unit and account, and in My work until someone replies.
        var view = await Ok(await s.Admin.GetAsync($"/api/inbox/{id}"));
        Assert.Equal(("CV-1001", "open", "42", "KC-042"), (view.GetProperty("conversation").GetProperty("ref").GetString(), view.GetProperty("conversation").GetProperty("status").GetString(),
            view.GetProperty("unit").GetProperty("number").GetString(), view.GetProperty("account").GetProperty("accountNo").GetString()));
        Assert.Equal("open", await WorkStatus(id, "owner-message"));

        // They wrote in the portal, so the reply goes there; it's recorded in Sent.
        Assert.Equal(HttpStatusCode.OK, (await Act(s.Admin, id, new { type = "reply", body = "Thanks, Sipho: the plumber is on the way." }, 2)).StatusCode);
        view = await Ok(await s.Admin.GetAsync($"/api/inbox/{id}"));
        Assert.Equal("waiting", view.GetProperty("conversation").GetProperty("status").GetString());
        var reply = view.GetProperty("conversation").GetProperty("messages")[1];
        Assert.Equal(("us", "portal"), (reply.GetProperty("from").GetString(), reply.GetProperty("channel").GetString()));
        Assert.Equal("done", await WorkStatus(id, "owner-message"));
        var sentId = reply.GetProperty("sentId").GetString();
        Assert.Equal("delivered", (await Ok(await s.Admin.GetAsync($"/api/communications/sent/{sentId}"))).GetProperty("message").GetProperty("deliveries")[0].GetProperty("status").GetString());

        // Sipho opens his messages in the portal: the reply is read.
        var mine = await Ok(await s.Owner.GetAsync("/api/me/conversations"));
        Assert.Equal("Thanks, Sipho: the plumber is on the way.", mine[0].GetProperty("conversation").GetProperty("messages")[1].GetProperty("body").GetString());
        var sent = await Ok(await s.Admin.GetAsync($"/api/communications/sent/{sentId}"));
        Assert.Equal(1, sent.GetProperty("counts").GetProperty("read").GetInt32());

        // His answer reopens it.
        await Id(await s.Owner.PostAsJsonAsync("/api/me/conversations", new { body = "Thank you!", conversationId = id.ToString() }));
        Assert.Equal("open", (await Ok(await s.Admin.GetAsync($"/api/inbox/{id}"))).GetProperty("conversation").GetProperty("status").GetString());
    }

    [Fact]
    public async Task Staff_reply_by_email_close_reopen_assign_and_turn_a_conversation_into_a_Task()
    {
        var s = await Scheme();
        var id = await Id(await s.Owner.PostAsJsonAsync("/api/me/conversations", new { subject = "Parking bay", body = "Someone keeps parking in my bay, number 42." }));
        api.Email.Sent.Clear();
        Assert.Equal(HttpStatusCode.OK, (await Act(s.Admin, id, new { type = "reply", body = "We’ve asked security to check.", channel = "email", close = true }, 2)).StatusCode);
        await HumoApiFactory.Until(() => !api.Email.Sent.IsEmpty);
        var email = Assert.Single(api.Email.Sent);
        Assert.Equal(("sipho@mail.example", "Re: Parking bay", "We’ve asked security to check."), (email.To, email.Subject, email.Text));
        Assert.Equal("closed", (await Ok(await s.Admin.GetAsync($"/api/inbox/{id}"))).GetProperty("conversation").GetProperty("status").GetString());

        Assert.True((await (await Act(s.Admin, id, new { type = "close" }, 3)).FieldErrors()).TryGetProperty("id", out _));
        Assert.Equal(HttpStatusCode.OK, (await Act(s.Admin, id, new { type = "reopen" }, 3)).StatusCode);
        Assert.Equal("open", await WorkStatus(id, "owner-message"));
        var admin = await api.Db(db => db.Users.Where(u => u.Email == "thandeka@acacia.example").Select(u => u.Id).SingleAsync());
        Assert.Equal(HttpStatusCode.OK, (await Act(s.Admin, id, new { type = "assign", assigneeId = admin.ToString() }, 4)).StatusCode);
        // The test factory names people from their email address.
        Assert.Equal("thandeka", (await Ok(await s.Admin.GetAsync($"/api/inbox/{id}"))).GetProperty("assigneeName").GetString());

        Assert.True((await (await Act(s.Admin, id, new { type = "to-job", title = "Paint the bay number", location = "Parking" }, 5)).FieldErrors()).TryGetProperty("title", out _));
        var task = await Ok(await Act(s.Admin, id, new { type = "to-task", title = "Paint the bay numbers", dueAt = "2026-10-30" }, 5));
        Assert.Equal("follow-up", await api.Db(db => db.WorkItems.Where(w => w.Id == Guid.Parse(task.GetProperty("id").GetString()!)).Select(w => w.Type).SingleAsync()));
        Assert.Equal("Task: Paint the bay numbers", (await Ok(await s.Admin.GetAsync($"/api/inbox/{id}"))).GetProperty("conversation").GetProperty("links")[0].GetProperty("label").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await Act(s.Admin, id, new { type = "close" }, 5)).StatusCode);
        // Residents see only their own.
        Assert.Equal(HttpStatusCode.NotFound, (await s.Owner.GetAsync($"/api/inbox/{id}")).StatusCode);
    }

    [Fact]
    public async Task Opening_a_notice_in_the_portal_shows_as_read_in_Sent()
    {
        var s = await Scheme();
        var notice = await Id(await s.Admin.PostAsJsonAsync("/api/notices", new { schemeId = s.Kc.ToString(), title = "New gate remotes", body = "Collect your new gate remote from the guardhouse, weekdays 08:00 to 17:00.", audience = "owners", category = "security", pinned = false }));
        await HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AllAsync(d => d.Status != "queued")));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Owner.PostAsync($"/api/me/notices/{notice}/read", null)).StatusCode);
        var sent = (await Ok(await s.Admin.GetAsync($"/api/communications/sent?schemeIds={s.Kc}")))[0];
        // Sipho prefers email; portal deliveries are the ones a portal visit can mark read.
        var deliveries = sent.GetProperty("message").GetProperty("deliveries").EnumerateArray().ToList();
        Assert.All(deliveries, d => Assert.Equal(d.GetProperty("channel").GetString() == "portal" ? "read" : "delivered", d.GetProperty("status").GetString()));
    }
}
