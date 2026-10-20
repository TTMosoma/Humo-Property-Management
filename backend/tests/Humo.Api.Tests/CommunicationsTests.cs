using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Api.Tests;

/// <summary>Compose, message templates and notices on the API (docs/18 R-5): who an audience reaches, merge fields per person, scheduling, and Sent.</summary>
public sealed class CommunicationsTests : IDisposable
{
    private readonly HumoApiFactory api = new HumoApiFactory().With("Sms:Provider", "Captured");

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Org, Guid Kc, HttpClient Admin);

    /// <summary>Kingfisher Court: unit 42 (Sipho: email, prefers email; R1 800 overdue) and unit 12 (Lindiwe: mobile only).</summary>
    private async Task<Setup> Scheme()
    {
        var org = await api.Customer("Acacia", "professional");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var u42 = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "42", description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1800, occupancy = "owner-occupied" }));
        var u12 = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "12", description = "3-bed", sizeM2 = 120, participationQuota = 2, monthlyLevy = 1800, occupancy = "owner-occupied" }));
        await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Sipho", lastName = "Khumalo", kind = "individual", email = "sipho@mail.example", phone = "083 551 0274", preferredChannel = "email" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = u42.ToString(), since = "2019-05-01" },
        }));
        await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Lindiwe", lastName = "Mokoena", kind = "individual", email = "", phone = "082 123 4567", preferredChannel = "sms" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = u12.ToString(), since = "2021-02-01" },
        }));
        await api.Db(async db =>
        {
            var a = await db.LevyAccounts.SingleAsync(x => x.UnitId == u42);
            (a.Balance, a.AgeingD30, a.Status) = (1800, 1800, "arrears");
            return await db.SaveChangesAsync();
        });
        api.Email.Sent.Clear();
        return new Setup(org, kc, admin);
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

    private static async Task NoContent(HttpResponseMessage res) =>
        Assert.True(res.StatusCode == HttpStatusCode.NoContent, $"{res.StatusCode}: {await res.Content.ReadAsStringAsync()}");

    private static object Owners(Guid kc) => new { schemeId = kc.ToString(), kind = "owners" };

    private Task Settled() => HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AllAsync(d => d.Status != "queued" || d.ProviderMessageId != null)));

    [Fact]
    public async Task Compose_reaches_each_person_by_a_channel_they_can_receive_with_their_own_merge_values()
    {
        var s = await Scheme();
        var templates = (await Ok(await s.Admin.GetAsync("/api/communications/templates"))).EnumerateArray().ToList();
        Assert.Equal(6, templates.Count);
        var reminder = templates.Single(t => t.GetProperty("name").GetString() == "Levy reminder");
        Assert.True(reminder.GetProperty("builtIn").GetBoolean());

        // Email only: Lindiwe can't be reached and is listed with the reason.
        var preview = await Ok(await s.Admin.PostAsJsonAsync("/api/communications/preview", new { audience = Owners(s.Kc), channels = new[] { "email" } }));
        Assert.Equal(("All owners · Kingfisher Court", 1), (preview.GetProperty("audienceLabel").GetString(), preview.GetProperty("recipients").GetArrayLength()));
        Assert.Equal("Can’t be reached by email", preview.GetProperty("skipped")[0].GetProperty("reason").GetString());
        preview = await Ok(await s.Admin.PostAsJsonAsync("/api/communications/preview", new { audience = Owners(s.Kc), channels = new[] { "email", "sms" } }));
        Assert.Equal((1, 1), (preview.GetProperty("byChannel").GetProperty("email").GetInt32(), preview.GetProperty("byChannel").GetProperty("sms").GetInt32()));
        preview = await Ok(await s.Admin.PostAsJsonAsync("/api/communications/preview", new { audience = new { schemeId = s.Kc.ToString(), kind = "arrears", minDays = 30 }, channels = new[] { "email" } }));
        Assert.Equal("Sipho Khumalo", Assert.Single(preview.GetProperty("recipients").EnumerateArray()).GetProperty("name").GetString());

        Assert.True((await (await s.Admin.PostAsJsonAsync("/api/communications/messages", new { audience = Owners(s.Kc), subject = "Hello", body = "Dear {person.surname}, hello there.", channels = new[] { "email" } })).FieldErrors()).TryGetProperty("body", out _));
        Assert.True((await (await s.Admin.PostAsJsonAsync("/api/communications/messages", new { audience = Owners(s.Kc), subject = "Hello", body = "WhatsApp only, please.", channels = new[] { "whatsapp" } })).FieldErrors()).TryGetProperty("audience", out _));

        var id = await Id(await s.Admin.PostAsJsonAsync("/api/communications/messages", new
        {
            audience = Owners(s.Kc), templateId = reminder.GetProperty("id").GetString(), subject = reminder.GetProperty("subject").GetString(), body = reminder.GetProperty("body").GetString(),
            channels = new[] { "email", "sms" },
        }));
        await Settled();
        var email = Assert.Single(api.Email.Sent);
        Assert.Equal(("sipho@mail.example", "Your levy account KC-042"), (email.To, email.Subject));
        Assert.StartsWith("Hi Sipho, a friendly reminder that R1", email.Text);
        var sms = Assert.Single(api.Sms.Sent);
        Assert.Contains("unit 12, Kingfisher Court", sms.Text);

        var view = await Ok(await s.Admin.GetAsync($"/api/communications/sent/{id}"));
        Assert.Equal(("message", "sending", 1, 1), (view.GetProperty("message").GetProperty("kind").GetString(), view.GetProperty("state").GetString(),
            view.GetProperty("counts").GetProperty("delivered").GetInt32(), view.GetProperty("counts").GetProperty("queued").GetInt32()));
        Assert.Equal(reminder.GetProperty("id").GetString(), view.GetProperty("message").GetProperty("templateId").GetString());
    }

    [Fact]
    public async Task A_scheduled_message_waits_for_its_time_and_can_be_cancelled_until_then()
    {
        var s = await Scheme();
        var tomorrow = api.Clock.GetUtcNow().AddDays(1).ToString("O");
        Assert.True((await (await s.Admin.PostAsJsonAsync("/api/communications/messages", new { audience = Owners(s.Kc), subject = "AGM", body = "The AGM is on Saturday at 10:00.", channels = new[] { "email" }, sendAt = api.Clock.GetUtcNow().AddHours(-2).ToString("O") })).FieldErrors()).TryGetProperty("sendAt", out _));

        var cancelled = await Id(await s.Admin.PostAsJsonAsync("/api/communications/messages", new { audience = Owners(s.Kc), subject = "AGM", body = "The AGM is on Saturday at 10:00.", channels = new[] { "email" }, sendAt = tomorrow }));
        Assert.Equal("scheduled", (await Ok(await s.Admin.GetAsync($"/api/communications/sent/{cancelled}"))).GetProperty("state").GetString());
        await NoContent(await s.Admin.PostAsync($"/api/communications/sent/{cancelled}/cancel", null));
        Assert.Equal("cancelled", (await Ok(await s.Admin.GetAsync($"/api/communications/sent/{cancelled}"))).GetProperty("state").GetString());

        var scheduled = await Id(await s.Admin.PostAsJsonAsync("/api/communications/messages", new { audience = Owners(s.Kc), subject = "AGM reminder", body = "Dear {person.name}, the AGM is on Saturday.", channels = new[] { "email" }, sendAt = tomorrow }));
        await Task.Delay(300);
        Assert.Empty(api.Email.Sent);

        api.Clock.Advance(TimeSpan.FromDays(2));
        using (var scope = api.Services.CreateScope())
            Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<Humo.Api.Messaging.Communications>().SendDueAsync(CancellationToken.None));
        Assert.Equal("Dear Sipho Khumalo, the AGM is on Saturday.", Assert.Single(api.Email.Sent).Text);
        // Two days on, the session has expired: sign in again.
        var admin = await api.SignedIn("thandeka@acacia.example");
        Assert.Equal("sent", (await Ok(await admin.GetAsync($"/api/communications/sent/{scheduled}"))).GetProperty("state").GetString());
        Assert.True((await (await admin.PostAsync($"/api/communications/sent/{scheduled}/cancel", null)).FieldErrors()).TryGetProperty("sendAt", out _));
    }

    [Fact]
    public async Task Templates_are_the_agencys_own_to_edit_and_starters_stay()
    {
        var s = await Scheme();
        var starter = (await Ok(await s.Admin.GetAsync("/api/communications/templates"))).EnumerateArray().First();
        var input = new { name = "Gate remotes", category = "general", subject = "New gate remotes at {scheme.name}", body = "Hi {person.firstName}, collect your new gate remote from the guardhouse.", channels = new[] { "email", "sms" } };
        var id = await Id(await s.Admin.PostAsJsonAsync("/api/communications/templates", input));
        Assert.Equal("There’s already a template with that name.", (await (await s.Admin.PostAsJsonAsync("/api/communications/templates", input)).FieldErrors()).GetProperty("name").GetString());
        Assert.True((await (await s.Admin.PostAsJsonAsync("/api/communications/templates", input with { name = "Long SMS", body = new string('x', 500) })).FieldErrors()).TryGetProperty("body", out _));

        Assert.Equal(HttpStatusCode.OK, (await s.Admin.PutAsJsonAsync($"/api/communications/templates/{id}", new { input.name, input.category, input.subject, body = input.body + " Bring your ID.", input.channels, expectedVersion = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await s.Admin.PutAsJsonAsync($"/api/communications/templates/{id}", new { input.name, input.category, input.subject, input.body, input.channels, expectedVersion = 1 })).StatusCode);
        Assert.True((await (await s.Admin.PostAsync($"/api/communications/templates/{starter.GetProperty("id").GetString()}/archive", null)).FieldErrors()).TryGetProperty("id", out _));
        await NoContent(await s.Admin.PostAsync($"/api/communications/templates/{id}/archive", null));
        Assert.DoesNotContain((await Ok(await s.Admin.GetAsync("/api/communications/templates"))).EnumerateArray(), t => t.GetProperty("id").GetString() == id.ToString());
    }

    [Fact]
    public async Task Notices_go_out_by_the_agencys_rule_and_residents_see_current_ones()
    {
        var s = await Scheme();
        // Sipho signs in to the resident portal: his sign-in is linked to his person record.
        var user = await api.Person("sipho@mail.example", Roles.Owner, s.Org, [s.Kc]);
        await api.Db(async db =>
        {
            var person = await db.People.SingleAsync(p => p.Email == "sipho@mail.example");
            (await db.Users.SingleAsync(u => u.Id == user)).PersonId = person.Id.ToString();
            return await db.SaveChangesAsync();
        });
        var notice = new { schemeId = s.Kc.ToString(), title = "Water off on Thursday", body = "The plumber replaces the main valve: water is off from 09:00 to 13:00 on Thursday.", audience = "owners", category = "maintenance", pinned = true };
        Assert.True((await (await s.Admin.PostAsJsonAsync("/api/notices", notice with { title = "Hi" })).FieldErrors()).TryGetProperty("title", out _));
        var id = await Id(await s.Admin.PostAsJsonAsync("/api/notices", notice));
        await Settled();

        var list = (await Ok(await s.Admin.GetAsync($"/api/notices?schemeIds={s.Kc}"))).EnumerateArray().ToList();
        var n = Assert.Single(list).GetProperty("notice");
        Assert.Equal(("NTC-KC-1", 2, true), (n.GetProperty("ref").GetString(), n.GetProperty("recipients").GetInt32(), n.GetProperty("pinned").GetBoolean()));
        Assert.Equal(["email", "portal"], n.GetProperty("sentBy").EnumerateArray().Select(c => c.GetString()));
        // Sipho has an email address and a portal account; Lindiwe has neither.
        var sent = (await Ok(await s.Admin.GetAsync($"/api/communications/sent?schemeIds={s.Kc}")))[0].GetProperty("message");
        Assert.Equal(("notice", "Notice NTC-KC-1"), (sent.GetProperty("kind").GetString(), sent.GetProperty("source").GetProperty("label").GetString()));
        Assert.Equal("Lindiwe Mokoena", Assert.Single(sent.GetProperty("skipped").EnumerateArray()).GetProperty("name").GetString());
        Assert.Equal("Water off on Thursday", Assert.Single(api.Email.Sent).Subject);

        var owner = await api.SignedIn("sipho@mail.example");
        Assert.Equal("Water off on Thursday", Assert.Single((await Ok(await owner.GetAsync("/api/me/notices"))).EnumerateArray()).GetProperty("notice").GetProperty("title").GetString());
        Assert.True((await (await s.Admin.PostAsJsonAsync($"/api/notices/{id}/actions", new { action = new { type = "withdraw", reason = "" }, expectedVersion = 1 })).FieldErrors()).TryGetProperty("reason", out _));
        await NoContent(await s.Admin.PostAsJsonAsync($"/api/notices/{id}/actions", new { action = new { type = "withdraw", reason = "Plumber postponed" }, expectedVersion = 1 }));
        Assert.Empty((await Ok(await owner.GetAsync("/api/me/notices"))).EnumerateArray());
        Assert.False((await Ok(await s.Admin.GetAsync($"/api/notices?schemeIds={s.Kc}")))[0].GetProperty("current").GetBoolean());
    }
}
