using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Credit control on the API (slice 2d; docs/11 §2): the case, its letters as issued documents, the trustees' approval and follow-up Tasks.</summary>
public sealed class CreditControlTests : IDisposable
{
    private readonly HumoApiFactory api = new HumoApiFactory().With("Sms:Provider", "Captured");

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Kc, Guid Account42, Guid Account12, HttpClient Admin, HttpClient Finance, HttpClient Trustee);

    /// <summary>Kingfisher Court: unit 42 (Sipho, email and mobile) and unit 12 (Lindiwe, mobile only), both R1 800 overdue for 30+ days.</summary>
    private async Task<Setup> Scheme(string package = "professional", bool withTrustAccount = true)
    {
        var org = await api.Customer("Acacia", package);
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        await api.Person("priya@acacia.example", Roles.Finance, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        await api.Person("bongani@trustee.example", Roles.Trustee, org, [kc]);
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
        var accounts = await api.Db(db => db.LevyAccounts.ToDictionaryAsync(a => a.UnitId, a => a.Id));
        foreach (var account in accounts.Values) await Overdue(account, 1800);
        if (withTrustAccount)
            await api.Db(async db =>
            {
                db.TrustAccounts.Add(new TrustAccountRow { SchemeId = kc, Bank = "FNB", AccountName = "Kingfisher Court Body Corporate", AccountNumber = "62345678901", BranchCode = "250655", Verified = true });
                return await db.SaveChangesAsync();
            });
        return new Setup(kc, accounts[u42], accounts[u12], admin, await api.SignedIn("priya@acacia.example"), await api.SignedIn("bongani@trustee.example"));
    }

    /// <summary>A levy charged on 1 September, unpaid: 30+ days overdue on 19 October.</summary>
    private Task Overdue(Guid account, decimal amount) => api.Db(async db =>
    {
        db.Ledger.Add(new LedgerEntry { Id = Guid.CreateVersion7(), AccountId = account, Date = new DateOnly(2026, 9, 1), Type = "levy", Description = "Levy — September", Amount = amount, CreatedBy = "test" });
        var a = await db.LevyAccounts.SingleAsync(x => x.Id == account);
        (a.Balance, a.AgeingD30, a.Status) = (amount, amount, "arrears");
        return await db.SaveChangesAsync();
    });

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

    private static async Task<JsonElement> Case(HttpClient c, Guid account) => await Ok(await c.GetAsync($"/api/collections/{account}"));

    private static Task<HttpResponseMessage> Act(HttpClient c, Guid account, object action, int version) =>
        c.PostAsJsonAsync($"/api/collections/{account}/actions", new { action, expectedVersion = version });

    private Task<List<WorkItemRow>> FollowUps(Guid account) => api.Db(db => db.WorkItems.Where(w => w.SourceId == account && w.Type == "debtor-follow-up").ToListAsync());

    /// <summary>Every letter issued so far has its PDF, and those by email or SMS have gone.</summary>
    private Task Delivered() => HumoApiFactory.Until(() => api.Db(db => db.IssuedLetters.AllAsync(l => l.Pdf != null && (l.Channel == "post" || l.DeliveredAt != null))));

    [Fact]
    public async Task Letters_go_in_order_as_issued_documents_and_a_letter_of_demand_needs_the_trustees()
    {
        var s = await Scheme();
        var list = await Ok(await s.Finance.GetAsync($"/api/collections?schemeIds={s.Kc}"));
        Assert.Equal(2, list.GetProperty("total").GetInt32());
        var view = await Case(s.Finance, s.Account42);
        Assert.Equal(("not-started", 1800m, 30, "Send a reminder"), (view.GetProperty("case").GetProperty("stage").GetString(), view.GetProperty("overdueAmount").GetDecimal(),
            view.GetProperty("daysInArrears").GetInt32(), view.GetProperty("next").GetProperty("label").GetString()));

        // Only the next letter.
        Assert.True((await (await Act(s.Finance, s.Account42, new { type = "send-letter", kind = "final-demand", channel = "email" }, 0)).FieldErrors()).TryGetProperty("stage", out _));
        await NoContent(await Act(s.Finance, s.Account42, new { type = "send-letter", kind = "reminder", channel = "email" }, 0));

        // Emailed with the letter attached, drawn from its snapshot (in the background: the screen doesn't wait).
        await Delivered();
        var email = Assert.Single(api.Email.Sent);
        Assert.Equal(("sipho@mail.example", "Reminder: levy account KC-042"), (email.To, email.Subject));
        Assert.Contains("62345678901", email.Text);
        var pdf = Assert.Single(email.Attachments!);
        Assert.StartsWith("KC-042-reminder-", pdf.FileName);
        var letter = await api.Db(db => db.IssuedLetters.SingleAsync());
        Assert.Equal(("reminder", "email", "payment-notice.standard"), (letter.Kind, letter.Channel, letter.TemplateId));
        Assert.Equal(Humo.Api.Finance.StatementService.Sha256(letter.Pdf!), letter.PdfSha256);
        Assert.NotNull(letter.DeliveredAt);

        // A follow-up Task, due when the final demand is (14 days by default).
        view = await Case(s.Finance, s.Account42);
        Assert.Equal(("reminder", "Send a final demand"), (view.GetProperty("case").GetProperty("stage").GetString(), view.GetProperty("next").GetProperty("label").GetString()));
        var task = Assert.Single(await FollowUps(s.Account42));
        Assert.Equal(api.Clock.GetUtcNow().AddDays(14), task.DueAt);

        // By post: nothing is sent; the agency prints the PDF.
        await NoContent(await Act(s.Finance, s.Account42, new { type = "send-letter", kind = "final-demand", channel = "post" }, 1));
        await Delivered();
        Assert.Single(api.Email.Sent);
        var stepId = (await Case(s.Finance, s.Account42)).GetProperty("lastStep").GetProperty("id").GetString();
        var posted = await s.Finance.GetAsync($"/api/collections/{s.Account42}/letters/{stepId}/pdf");
        Assert.Equal("application/pdf", posted.Content.Headers.ContentType?.MediaType);
        Assert.Contains("final-demand", await posted.Content.ReadAsStringAsync());

        // A letter of demand: the trustees first.
        Assert.Equal("A letter of demand needs the trustees’ approval first.",
            (await (await Act(s.Finance, s.Account42, new { type = "send-letter", kind = "letter-of-demand", channel = "sms" }, 2)).FieldErrors()).GetProperty("approval").GetString());
        await NoContent(await Act(s.Finance, s.Account42, new { type = "request-demand-approval" }, 2));
        var approval = Assert.Single((await Ok(await s.Trustee.GetAsync("/api/work-items"))).EnumerateArray(), w => w.GetProperty("kind").GetString() == "approval");
        Assert.Equal(("demand-approval", 1800m), (approval.GetProperty("type").GetString(), approval.GetProperty("amount").GetDecimal()));
        Assert.Equal("forbidden", await (await s.Finance.PostAsJsonAsync($"/api/work-items/{approval.GetProperty("id").GetString()}/decision", new { decision = "approved" })).ProblemCode());
        await NoContent(await s.Trustee.PostAsJsonAsync($"/api/work-items/{approval.GetProperty("id").GetString()}/decision", new { decision = "approved" }));
        view = await Case(s.Finance, s.Account42);
        Assert.Equal(("approved", "Send the letter of demand"), (view.GetProperty("case").GetProperty("demandApproval").GetProperty("status").GetString(), view.GetProperty("next").GetProperty("label").GetString()));

        // By SMS: a short notice with the reference.
        await NoContent(await Act(s.Finance, s.Account42, new { type = "send-letter", kind = "letter-of-demand", channel = "sms" }, 4));
        await HumoApiFactory.Until(() => !api.Sms.Sent.IsEmpty);
        var sms = Assert.Single(api.Sms.Sent);
        Assert.Equal("083 551 0274", sms.To);
        Assert.Contains("reference KC-042", sms.Text);

        // Hand-over, after the letter of demand. The account shows it.
        Assert.True((await (await Act(s.Finance, s.Account42, new { type = "hand-over", attorney = " " }, 5)).FieldErrors()).TryGetProperty("attorney", out _));
        await NoContent(await Act(s.Finance, s.Account42, new { type = "hand-over", attorney = "Botha & Partners" }, 5));
        Assert.Equal("handed-over", await api.Db(db => db.LevyAccounts.Where(a => a.Id == s.Account42).Select(a => a.Status).SingleAsync()));
        // One open follow-up at a time.
        Assert.Equal(["Check progress with the attorney"], (await FollowUps(s.Account42)).Where(w => w.Status == "open").Select(w => w.Title[(w.Title.IndexOf('—') + 2)..]).Select(t => char.ToUpperInvariant(t[0]) + t[1..]));
        Assert.Equal(HttpStatusCode.Conflict, (await Act(s.Finance, s.Account42, new { type = "note", text = "Called the attorney" }, 5)).StatusCode);
    }

    [Fact]
    public async Task Bulk_reminders_arrangements_and_disputes()
    {
        var s = await Scheme();
        // Lindiwe has no email address: skipped, and the count says so.
        Assert.Equal(1, await (await s.Finance.PostAsJsonAsync("/api/collections/reminders", new { accountIds = new[] { s.Account42.ToString(), s.Account12.ToString() }, channel = "email" })).Content.ReadFromJsonAsync<int>());
        await HumoApiFactory.Until(() => !api.Email.Sent.IsEmpty);
        Assert.Equal("sipho@mail.example", Assert.Single(api.Email.Sent).To);
        Assert.Equal(1, await (await s.Finance.PostAsJsonAsync("/api/collections/reminders", new { accountIds = new[] { s.Account42.ToString(), s.Account12.ToString() }, channel = "sms" })).Content.ReadFromJsonAsync<int>());
        await HumoApiFactory.Until(() => !api.Sms.Sent.IsEmpty);
        Assert.Equal("082 123 4567", Assert.Single(api.Sms.Sent).To);

        // An arrangement must clear what's overdue.
        Assert.True((await (await Act(s.Finance, s.Account42, new { type = "arrangement", instalment = 100, day = 1, months = 6 }, 1)).FieldErrors()).TryGetProperty("instalment", out _));
        await NoContent(await Act(s.Finance, s.Account42, new { type = "arrangement", instalment = 300, day = 1, months = 6 }, 1));
        Assert.Equal("arrangement", await api.Db(db => db.LevyAccounts.Where(a => a.Id == s.Account42).Select(a => a.Status).SingleAsync()));
        Assert.StartsWith("Check the", (await Case(s.Finance, s.Account42)).GetProperty("next").GetProperty("label").GetString());
        await NoContent(await Act(s.Finance, s.Account42, new { type = "missed-instalment" }, 2));
        var view = await Case(s.Finance, s.Account42);
        Assert.Equal(("reminder", "arrears"), (view.GetProperty("case").GetProperty("stage").GetString(), view.GetProperty("account").GetProperty("status").GetString()));

        // A dispute pauses collection until it's resolved.
        Assert.True((await (await Act(s.Finance, s.Account12, new { type = "dispute", reason = "Wrong" }, 1)).FieldErrors()).TryGetProperty("reason", out _));
        await NoContent(await Act(s.Finance, s.Account12, new { type = "dispute", reason = "Owner says September was paid in cash at the office." }, 1));
        Assert.True((await (await Act(s.Finance, s.Account12, new { type = "send-letter", kind = "final-demand", channel = "post" }, 2)).FieldErrors()).TryGetProperty("stage", out _));
        await NoContent(await Act(s.Finance, s.Account12, new { type = "resolve-dispute", outcome = "resume", note = "No cash receipt on record; owner agreed." }, 2));
        Assert.Equal("reminder", (await Case(s.Finance, s.Account12)).GetProperty("case").GetProperty("stage").GetString());
    }

    [Fact]
    public async Task Credit_control_follows_the_plan_and_needs_somewhere_to_pay()
    {
        var s = await Scheme(withTrustAccount: false);
        Assert.Equal(Humo.Api.Finance.CreditControl.NoTrustAccount,
            (await (await Act(s.Finance, s.Account42, new { type = "send-letter", kind = "reminder", channel = "post" }, 0)).FieldErrors()).GetProperty("channel").GetString());
        // Trustees decide letters of demand; they don't run credit control.
        Assert.Equal(HttpStatusCode.NotFound, (await Act(s.Trustee, s.Account42, new { type = "note", text = "Hello" }, 0)).StatusCode);

        using var other = new HumoApiFactory();
        var org = await other.Customer("Small", "essentials");
        await other.Person("admin@small.example", Roles.AgencyAdmin, org);
        var admin = await other.SignedIn("admin@small.example");
        var scheme = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Bluegum", code = "BG", type = "Sectional Title", suburb = "Hatfield", city = "Pretoria", province = "Gauteng" }));
        var unit = await Id(await admin.PostAsJsonAsync($"/api/schemes/{scheme}/units", new { number = "1", description = "1-bed", sizeM2 = 50, participationQuota = 1, monthlyLevy = 900, occupancy = "owner-occupied" }));
        await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Ann", lastName = "Owner", kind = "individual", email = "ann@mail.example", phone = "083 000 0000", preferredChannel = "email" },
            link = new { type = "owner", schemeId = scheme.ToString(), unitId = unit.ToString(), since = "2020-01-01" },
        }));
        var account = await other.Db(db => db.LevyAccounts.Select(a => a.Id).SingleAsync());
        Assert.Equal("not-entitled", await (await Act(admin, account, new { type = "note", text = "Hello" }, 0)).ProblemCode());
    }
}
