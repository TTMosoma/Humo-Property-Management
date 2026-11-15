using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>A resident's own request: they hear about each step, and see only what's meant for them.</summary>
public sealed class ResidentRequestTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Kc, HttpClient Admin, HttpClient Owner);

    private async Task<Setup> Scheme()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
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
        return new Setup(kc, admin, await api.SignedIn("sipho@mail.example"));
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static async Task<string> Report(Setup s)
    {
        var res = await s.Owner.PostAsJsonAsync("/api/jobs", new { title = "Geyser leaking", description = "Dripping since this morning.", category = "Plumbing" });
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return (await res.Json()).GetProperty("id").GetString()!;
    }

    private static async Task Act(HttpClient c, string reference, object action, bool resident = false)
    {
        var version = resident
            ? (await Mine(c)).GetProperty("job").GetProperty("version").GetInt32()
            : (await (await c.GetAsync($"/api/jobs/{reference}")).Json()).GetProperty("job").GetProperty("version").GetInt32();
        var res = await c.PostAsJsonAsync($"/api/jobs/{reference}/actions", new { action, expectedVersion = version });
        Assert.True(res.StatusCode == HttpStatusCode.NoContent, $"{res.StatusCode}: {await res.Content.ReadAsStringAsync()}");
    }

    private static async Task<List<string>> Bell(HttpClient c) =>
        [.. (await (await c.GetAsync("/api/notifications")).Json()).EnumerateArray().Select(n => n.GetProperty("title").GetString()!)];

    private static async Task<JsonElement> Mine(HttpClient c) => Assert.Single((await (await c.GetAsync("/api/me/jobs")).Json()).EnumerateArray());

    private List<string> EmailsTo(string address) => [.. api.Email.Sent.Where(m => m.To == address).Select(m => m.Subject)];

    [Fact]
    public async Task A_resident_hears_each_step_and_is_emailed_for_the_booking_the_finish_and_the_end()
    {
        var s = await Scheme();
        var supplier = await Id(await s.Admin.PostAsJsonAsync("/api/suppliers", new
        {
            name = "Aqua Plumbing", trades = new[] { "Plumbing" }, contactName = "Peter Nel", phone = "082 555 0142", email = "jobs@aqua.example", schemeIds = new[] { s.Kc.ToString() },
        }));
        var reference = await Report(s);

        await Act(s.Admin, reference, new { type = "request-quotes", supplierIds = new[] { supplier.ToString() } });
        Assert.Contains($"Your request {reference} is being arranged", await Bell(s.Owner));

        var quote = (await (await s.Admin.GetAsync($"/api/jobs/{reference}")).Json()).GetProperty("job").GetProperty("quotes")[0].GetProperty("id").GetString();
        await Act(s.Admin, reference, new { type = "record-quote", quoteId = quote, amount = 1_200 });
        await Act(s.Admin, reference, new { type = "approve-within-delegation", quoteId = quote });
        await Act(s.Admin, reference, new { type = "issue-work-order", scheduledFor = api.Clock.GetUtcNow().AddDays(1).ToString("O"), accessNotes = "Caretaker has keys", overrideVetting = true });
        await Act(s.Admin, reference, new { type = "complete", notes = "Valve replaced" });

        var bell = await Bell(s.Owner);
        Assert.Contains("Booked: Geyser leaking", bell);
        Assert.Contains("Was it fixed? Geyser leaking", bell);
        // Quoting and approving are the agency's business: one "being arranged", nothing per quote.
        Assert.Equal(3, bell.Count);
        await HumoApiFactory.Until(() => EmailsTo("sipho@mail.example").Count >= 2);
        Assert.Equal(["Booked: Geyser leaking", "Was it fixed? Geyser leaking"], EmailsTo("sipho@mail.example").Order());

        // The history says he was told, because he was.
        var events = (await (await s.Admin.GetAsync($"/api/jobs/{reference}")).Json()).GetProperty("job").GetProperty("events").EnumerateArray().Select(e => e.GetProperty("text").GetString()!).ToList();
        Assert.Contains(events, e => e.StartsWith("Sipho Khumalo told: “Booked", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_cancelled_request_tells_the_resident_why_by_bell_and_email_and_shows_it()
    {
        var s = await Scheme();
        var reference = await Report(s);

        await Act(s.Admin, reference, new { type = "cancel", reason = "Already fixed by the caretaker" });

        Assert.Contains("Cancelled: Geyser leaking", await Bell(s.Owner));
        await HumoApiFactory.Until(() => EmailsTo("sipho@mail.example").Contains("Cancelled: Geyser leaking"));
        Assert.Contains("Already fixed by the caretaker", api.Email.Sent.Single(m => m.Subject == "Cancelled: Geyser leaking").Text);
        var job = (await Mine(s.Owner)).GetProperty("job");
        Assert.Equal("cancelled", job.GetProperty("stage").GetString());
        Assert.Equal("Cancelled: Already fixed by the caretaker", job.GetProperty("events")[0].GetProperty("text").GetString());
    }

    [Fact]
    public async Task A_resident_sees_their_request_but_not_the_quotes_staff_notes_or_the_suppliers_details()
    {
        var s = await Scheme();
        var supplier = await Id(await s.Admin.PostAsJsonAsync("/api/suppliers", new
        {
            name = "Aqua Plumbing", trades = new[] { "Plumbing" }, contactName = "Peter Nel", phone = "082 555 0142", email = "jobs@aqua.example", schemeIds = new[] { s.Kc.ToString() },
        }));
        var reference = await Report(s);
        await Act(s.Admin, reference, new { type = "comment", text = "Owner is difficult, call before visiting" });
        await Act(s.Admin, reference, new { type = "request-quotes", supplierIds = new[] { supplier.ToString() } });
        var quote = (await (await s.Admin.GetAsync($"/api/jobs/{reference}")).Json()).GetProperty("job").GetProperty("quotes")[0].GetProperty("id").GetString();
        await Act(s.Admin, reference, new { type = "record-quote", quoteId = quote, amount = 1_200 });
        await Act(s.Admin, reference, new { type = "approve-within-delegation", quoteId = quote });

        var mine = await Mine(s.Owner);
        var raw = mine.GetRawText();
        Assert.Equal(0, mine.GetProperty("job").GetProperty("quotes").GetArrayLength());
        Assert.DoesNotContain("difficult", raw);
        Assert.DoesNotContain("1200", raw);
        Assert.DoesNotContain("R1 200", raw);
        Assert.DoesNotContain("jobs@aqua.example", raw);
        Assert.False(mine.GetProperty("job").TryGetProperty("approval", out _));
        Assert.Equal(
            ["The managing agent is arranging a supplier", "Reported"],
            mine.GetProperty("job").GetProperty("events").EnumerateArray().Select(e => e.GetProperty("text").GetString()));
    }

    [Fact]
    public async Task Closing_a_request_the_resident_already_confirmed_tells_them_nothing_more()
    {
        var s = await Scheme();
        var reference = await Report(s);
        await Act(s.Admin, reference, new { type = "complete", notes = "Caretaker replaced the valve" });
        await Act(s.Owner, reference, new { type = "verify", outcome = "fixed" }, resident: true);

        await Act(s.Admin, reference, new { type = "close" });

        Assert.DoesNotContain(await Bell(s.Owner), t => t.StartsWith("Closed:", StringComparison.Ordinal));
    }
}
