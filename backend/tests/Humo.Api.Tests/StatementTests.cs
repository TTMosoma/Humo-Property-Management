using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Settings, document templates and levy statements on the API (slice 2c; D7–D10).</summary>
public sealed class StatementTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Kc, Guid Account42, HttpClient Admin, HttpClient Finance);

    /// <summary>Kingfisher Court: unit 42 (Sipho Khumalo, R1 850 a month) and unit 12 (no owner yet).</summary>
    private async Task<Setup> Scheme(string package = "professional", bool withTrustAccount = true)
    {
        var org = await api.Customer("Acacia", package);
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        await api.Person("priya@acacia.example", Roles.Finance, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var u42 = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "42", description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1850, occupancy = "owner-occupied" }));
        await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "12", description = "3-bed", sizeM2 = 120, participationQuota = 2, monthlyLevy = 2400, occupancy = "owner-occupied" }));
        await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Sipho", lastName = "Khumalo", kind = "individual", email = "sipho@mail.example", phone = "083 551 0274", preferredChannel = "email" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = u42.ToString(), since = "2019-05-01" },
        }));
        var account = await api.Db(db => db.LevyAccounts.Where(a => a.UnitId == u42).Select(a => a.Id).SingleAsync());
        if (withTrustAccount)
            await api.Db(async db =>
            {
                db.TrustAccounts.Add(new TrustAccountRow { SchemeId = kc, Bank = "FNB", AccountName = "Kingfisher Court Body Corporate", AccountNumber = "62345678901", BranchCode = "250655", Verified = true });
                return await db.SaveChangesAsync();
            });
        return new Setup(kc, account, admin, await api.SignedIn("priya@acacia.example"));
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

    private static Task<HttpResponseMessage> Act(HttpClient c, Guid run, object action, int version) => c.PostAsJsonAsync($"/api/billing/runs/{run}/actions", new { action, expectedVersion = version });

    /// <summary>November's run, prepared by finance, approved by the administrator and posted.</summary>
    private static async Task<(Guid Id, int Version)> PostedRun(Setup s)
    {
        var id = await Id(await s.Finance.PostAsJsonAsync("/api/billing/runs", new { schemeId = s.Kc.ToString(), period = "2026-11" }));
        var run = (await Ok(await s.Finance.GetAsync($"/api/billing/runs/{id}"))).GetProperty("run");
        var v = 1;
        foreach (var e in run.GetProperty("exceptions").EnumerateArray())
            await NoContent(await Act(s.Finance, id, new { type = "decide", exceptionId = e.GetProperty("id").GetString(), decision = e.GetProperty("options")[0].GetString() }, v++));
        await NoContent(await Act(s.Finance, id, new { type = "send-for-approval" }, v++));
        var approval = (await Ok(await s.Admin.GetAsync("/api/work-items")))[0].GetProperty("id").GetString();
        await NoContent(await s.Admin.PostAsJsonAsync($"/api/work-items/{approval}/decision", new { decision = "approved" }));
        await NoContent(await Act(s.Finance, id, new { type = "post" }, ++v));
        return (id, v + 1);
    }

    private static async Task Eventually(Func<Task<bool>> done)
    {
        for (var i = 0; i < 100 && !await done(); i++) await Task.Delay(50);
        Assert.True(await done(), "Timed out waiting for the background delivery");
    }

    [Fact]
    public async Task A_run_issues_statements_as_snapshots_with_PDFs_and_emails_a_portal_link()
    {
        var s = await Scheme();
        var (run, version) = await PostedRun(s);
        var url = $"/api/accounts/{s.Account42}/statements/2026-11";

        // Before issue: worked out from the ledger, in Humo's default template.
        var draft = await Ok(await s.Finance.GetAsync(url));
        Assert.Equal((0m, 1850m, 1850m, "2026-11-07"), (draft.GetProperty("statement").GetProperty("opening").GetDecimal(), draft.GetProperty("statement").GetProperty("charges").GetDecimal(),
            draft.GetProperty("statement").GetProperty("closing").GetDecimal(), draft.GetProperty("statement").GetProperty("dueOn").GetString()));
        Assert.Equal("levy-statement.standard", draft.GetProperty("issuedWith").GetProperty("templateId").GetString());
        Assert.False(draft.TryGetProperty("issued", out _));
        Assert.Equal(HttpStatusCode.NotFound, (await s.Finance.GetAsync($"{url}/pdf")).StatusCode);

        // The agency's default: the branded Professional statement (its plan includes premium templates).
        await NoContent(await s.Admin.PutAsJsonAsync("/api/documents/settings/defaults/levy-statement", new { templateId = "levy-statement.professional", expectedVersion = 0 }));
        await NoContent(await Act(s.Finance, run, new { type = "send-statements" }, version));

        var sent = (await Ok(await s.Finance.GetAsync($"/api/billing/runs/{run}"))).GetProperty("run");
        Assert.Equal("sent", sent.GetProperty("stage").GetString());
        Assert.Equal((1, "levy-statement.professional"), (sent.GetProperty("statements").GetProperty("email").GetInt32(), sent.GetProperty("statements").GetProperty("template").GetProperty("templateId").GetString()));
        Assert.True((await (await Act(s.Finance, run, new { type = "send-statements" }, version + 1)).FieldErrors()).TryGetProperty("stage", out _));

        // D9: a secure link to the resident portal, no attachment.
        await Eventually(() => Task.FromResult(!api.Email.Sent.IsEmpty));
        var email = Assert.Single(api.Email.Sent);
        Assert.Equal("sipho@mail.example", email.To);
        Assert.Contains("/my/statements/2026-11", email.Text);
        Assert.Contains(Humo.Domain.Finance.BillingRules.Rand(1850), email.Text);
        Assert.Null(email.Attachments);

        // In Communications › Sent: one record for the run, its delivery as the mail server reported it (R-5).
        await HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AnyAsync(d => d.Status == "delivered")));
        var record = Assert.Single((await Ok(await s.Finance.GetAsync($"/api/communications/sent?schemeIds={s.Kc}"))).EnumerateArray()).GetProperty("message");
        Assert.Equal(("statement", "Owners · Kingfisher Court", "Billing run BR-KC-2611"), (record.GetProperty("kind").GetString(), record.GetProperty("audienceLabel").GetString(),
            record.GetProperty("source").GetProperty("label").GetString()));
        Assert.Equal(("delivered", "sipho@mail.example"), (record.GetProperty("deliveries")[0].GetProperty("status").GetString(), record.GetProperty("deliveries")[0].GetProperty("address").GetString()));

        // D7: the snapshot and its hash, and the PDF drawn from it, with its own hash.
        await Eventually(() => api.Db(db => db.IssuedStatements.AnyAsync(x => x.Pdf != null)));
        var issued = await api.Db(db => db.IssuedStatements.SingleAsync());
        Assert.Equal(Humo.Api.Finance.StatementService.Sha256(Encoding.UTF8.GetBytes(issued.Snapshot)), issued.SnapshotSha256);
        Assert.Equal(Humo.Api.Finance.StatementService.Sha256(issued.Pdf!), issued.PdfSha256);
        Assert.Equal(("levy-statement.professional", 1, "email", run), (issued.TemplateId, issued.TemplateVersion, issued.SentBy, issued.BillingRunId!.Value));
        // The print token worked once and is gone.
        var token = api.Pdf.Urls.Single()[(api.Pdf.Urls.Single().LastIndexOf('/') + 1)..];
        Assert.Contains("/print/statement/", api.Pdf.Urls.Single());
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client().GetAsync($"/api/print/statements/{token}")).StatusCode);

        // Issued means frozen: a later payment and a new default change nothing on it.
        await api.Db(async db =>
        {
            db.Ledger.Add(new LedgerEntry { Id = Guid.CreateVersion7(), AccountId = s.Account42, Date = new DateOnly(2026, 11, 20), Type = "payment", Description = "Payment", Amount = -500, CreatedBy = "test" });
            return await db.SaveChangesAsync();
        });
        await NoContent(await s.Admin.PutAsJsonAsync("/api/documents/settings/defaults/levy-statement", new { templateId = "levy-statement.standard", expectedVersion = 1 }));
        var view = await Ok(await s.Finance.GetAsync(url));
        Assert.Equal(1850m, view.GetProperty("statement").GetProperty("closing").GetDecimal());
        Assert.Equal("levy-statement.professional", view.GetProperty("issuedWith").GetProperty("templateId").GetString());
        Assert.Equal(issued.SnapshotSha256, view.GetProperty("issued").GetProperty("sha256").GetString());

        // The PDF as sent: to staff, and to the owner for their own account.
        var pdf = await s.Finance.GetAsync($"{url}/pdf");
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType?.MediaType);
        Assert.Equal(issued.Pdf, await pdf.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task Emailing_one_statement_attaches_the_PDF_when_the_agency_chose_that()
    {
        var s = await Scheme();
        await PostedRun(s);
        Assert.True((await (await s.Finance.PostAsync($"/api/accounts/{s.Account42}/statements/2026-08/send", null)).FieldErrors()).TryGetProperty("period", out _));

        // Branding needs a valid palette; the delivery choice is an agency setting.
        Assert.True((await (await s.Admin.PutAsJsonAsync("/api/documents/settings/branding", new
        {
            contact = new { email = "accounts@acacia.example", phone = "011 555 0100" },
            branding = new { palette = new { primary = "navy", accent = "#1d7a52" }, font = "outfit" },
            statementDelivery = "attachment", expectedVersion = 0,
        })).FieldErrors()).TryGetProperty("primary", out _));
        await NoContent(await s.Admin.PutAsJsonAsync("/api/documents/settings/branding", new
        {
            contact = new { email = "accounts@acacia.example", phone = "011 555 0100" },
            footerText = "Acacia Property Management (Pty) Ltd · FFC 2026/123",
            branding = new { logo = new { kind = "wordmark", text = "ACACIA" }, palette = new { primary = "#0a3d62", accent = "#1d7a52" }, font = "outfit" },
            statementDelivery = "attachment", expectedVersion = 0,
        }));
        var settings = await Ok(await s.Admin.GetAsync("/api/documents/settings"));
        Assert.Equal(("attachment", "#0a3d62"), (settings.GetProperty("statementDelivery").GetString(), settings.GetProperty("branding").GetProperty("palette").GetProperty("primary").GetString()));

        await NoContent(await s.Admin.PutAsJsonAsync("/api/documents/settings/defaults/levy-statement", new { templateId = "levy-statement.professional", expectedVersion = 1 }));
        var res = await s.Finance.PostAsync($"/api/accounts/{s.Account42}/statements/2026-11/send", null);
        Assert.True(res.StatusCode == HttpStatusCode.OK, await res.Content.ReadAsStringAsync());
        await HumoApiFactory.Until(() => !api.Email.Sent.IsEmpty);
        var email = Assert.Single(api.Email.Sent);
        var pdf = Assert.Single(email.Attachments!);
        Assert.Equal(("application/pdf", true), (pdf.ContentType, pdf.FileName.EndsWith("-2026-11.pdf")));
        Assert.Contains("accounts@acacia.example", email.Text);
        // The snapshot carries the branding and contact details as they were when it was issued.
        var snapshot = JsonDocument.Parse((await api.Db(db => db.IssuedStatements.SingleAsync())).Snapshot).RootElement;
        Assert.Equal(("agency", "ACACIA"), (snapshot.GetProperty("branding").GetProperty("source").GetString(), snapshot.GetProperty("branding").GetProperty("logo").GetProperty("text").GetString()));

        // The screen shows what the PDF shows: the agency changes its logo, and the issued statement doesn't change.
        var current = await Ok(await s.Admin.GetAsync("/api/documents/settings"));
        await NoContent(await s.Admin.PutAsJsonAsync("/api/documents/settings/branding", new
        {
            contact = new { email = "accounts@acacia.example", phone = "011 555 0100" },
            footerText = "Acacia Property Management (Pty) Ltd · FFC 2026/123",
            branding = new { logo = new { kind = "wordmark", text = "ACACIA 2" }, palette = new { primary = "#0a3d62", accent = "#1d7a52" }, font = "outfit" },
            statementDelivery = "attachment", expectedVersion = current.GetProperty("version").GetInt32(),
        }));
        Assert.Equal("ACACIA 2", (await Ok(await s.Admin.GetAsync("/api/documents/settings"))).GetProperty("branding").GetProperty("logo").GetProperty("text").GetString());
        var issuedView = await Ok(await s.Finance.GetAsync($"/api/accounts/{s.Account42}/statements/2026-11"));
        Assert.Equal(("ACACIA", "Acacia Property Management (Pty) Ltd · FFC 2026/123"),
            (issuedView.GetProperty("branding").GetProperty("logo").GetProperty("text").GetString(), issuedView.GetProperty("documentSettings").GetProperty("footerText").GetString()));
    }

    [Fact]
    public async Task Staff_revoke_an_emailed_statement_link_and_it_stops_working()
    {
        var s = await Scheme();
        await PostedRun(s);
        Assert.Equal(HttpStatusCode.OK, (await s.Finance.PostAsync($"/api/accounts/{s.Account42}/statements/2026-11/send", null)).StatusCode);
        await HumoApiFactory.Until(() => !api.Email.Sent.IsEmpty);
        var token = System.Text.RegularExpressions.Regex.Match(Assert.Single(api.Email.Sent).Text, "/d/([0-9a-f]{64})").Groups[1].Value;
        var delivery = await api.Db(db => db.Deliveries.Where(d => d.DocumentId != null).Select(d => new { d.Id, d.SentMessageId }).SingleAsync());
        var anyone = api.Client();
        Assert.Equal(HttpStatusCode.OK, (await anyone.GetAsync($"/api/document-links/{token}")).StatusCode);

        var revoke = $"/api/communications/sent/{delivery.SentMessageId}/deliveries/{delivery.Id}/revoke-link";
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsync(revoke, null)).StatusCode);
        Assert.NotEqual(HttpStatusCode.OK, (await anyone.GetAsync($"/api/document-links/{token}")).StatusCode);
        Assert.Contains("no open link", (await (await s.Finance.PostAsync(revoke, null)).FieldErrors()).GetProperty("link").GetString());
    }

    [Fact]
    public async Task An_owner_opens_their_statement_from_the_email_with_a_code_and_no_account()
    {
        var s = await Scheme();
        await PostedRun(s);
        var res = await s.Finance.PostAsync($"/api/accounts/{s.Account42}/statements/2026-11/send", null);
        Assert.True(res.StatusCode == HttpStatusCode.OK, await res.Content.ReadAsStringAsync());
        await HumoApiFactory.Until(() => !api.Email.Sent.IsEmpty);
        var email = Assert.Single(api.Email.Sent);
        var token = System.Text.RegularExpressions.Regex.Match(email.Text, "/d/([0-9a-f]{64})").Groups[1].Value;
        Assert.NotEmpty(token);
        Assert.Contains("one-time code", email.Text);
        await HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AnyAsync(d => d.Status == "delivered")));

        // No session: the link alone shows only what it is and where the code will go.
        var anyone = api.Client();
        var link = $"/api/document-links/{token}";
        Assert.Equal(HttpStatusCode.NotFound, (await anyone.GetAsync($"/api/document-links/{new string('0', 64)}")).StatusCode);
        var info = await Ok(await anyone.GetAsync(link));
        Assert.Equal(("Levy statement · November 2026", "Kingfisher Court", "sms", "the number ending 0274"), (info.GetProperty("title").GetString(),
            info.GetProperty("schemeName").GetString(), info.GetProperty("codeChannel").GetString(), info.GetProperty("codeSentTo").GetString()));
        Assert.Equal(HttpStatusCode.Unauthorized, (await anyone.GetAsync($"{link}/document")).StatusCode);

        // The code goes by SMS to the mobile on record, and counts in the agency's SMS this month.
        Assert.Equal("sms", (await Ok(await anyone.PostAsync($"{link}/code", null))).GetProperty("channel").GetString());
        var sms = Assert.Single(api.Sms.Sent);
        Assert.Equal("27835510274", sms.To);
        var code = System.Text.RegularExpressions.Regex.Match(sms.Text, "^\\d{6}").Value;
        Assert.Equal(1, await api.Db(db => db.MessageUsage.Where(u => u.Channel == "sms").Select(u => u.Units).SingleAsync()));
        Assert.Equal(HttpStatusCode.TooManyRequests, (await anyone.PostAsync($"{link}/code", null)).StatusCode);

        var wrong = ((int.Parse(code) + 1) % 1_000_000).ToString("D6");
        var refused = await anyone.PostAsJsonAsync($"{link}/verify", new { code = wrong });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal("wrong-code", (await refused.Json()).GetProperty("code").GetString());
        var grant = (await Ok(await anyone.PostAsJsonAsync($"{link}/verify", new { code }))).GetProperty("grant").GetString();
        // A code works once.
        Assert.Equal(HttpStatusCode.BadRequest, (await anyone.PostAsJsonAsync($"{link}/verify", new { code })).StatusCode);

        anyone.DefaultRequestHeaders.Add("X-Document-Grant", grant);
        var snapshot = await Ok(await anyone.GetAsync($"{link}/document"));
        Assert.Equal("2026-11", snapshot.GetProperty("view").GetProperty("statement").GetProperty("period").GetString());
        var pdf = await anyone.GetAsync($"{link}/pdf");
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType?.MediaType);
        // Opening it shows as read in Communications › Sent.
        Assert.Equal("read", await api.Db(db => db.Deliveries.Select(d => d.Status).SingleAsync()));

        // The viewing grant lasts 30 minutes; the link 90 days.
        api.Clock.Advance(TimeSpan.FromMinutes(31));
        Assert.Equal(HttpStatusCode.Unauthorized, (await anyone.GetAsync($"{link}/document")).StatusCode);
        api.Clock.Advance(TimeSpan.FromDays(90));
        Assert.Equal(HttpStatusCode.Gone, (await anyone.GetAsync(link)).StatusCode);
    }

    [Fact]
    public async Task With_no_mobile_on_record_the_code_goes_by_email()
    {
        var s = await Scheme();
        await PostedRun(s);
        await api.Db(async db =>
        {
            (await db.People.SingleAsync(p => p.Email == "sipho@mail.example")).Phone = "";
            return await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.OK, (await s.Finance.PostAsync($"/api/accounts/{s.Account42}/statements/2026-11/send", null)).StatusCode);
        await HumoApiFactory.Until(() => !api.Email.Sent.IsEmpty);
        var token = System.Text.RegularExpressions.Regex.Match(Assert.Single(api.Email.Sent).Text, "/d/([0-9a-f]{64})").Groups[1].Value;

        var anyone = api.Client();
        var sent = await Ok(await anyone.PostAsync($"/api/document-links/{token}/code", null));
        Assert.Equal(("email", "s•••@mail.example"), (sent.GetProperty("channel").GetString(), sent.GetProperty("sentTo").GetString()));
        Assert.Empty(api.Sms.Sent);
        var codeEmail = api.Email.Sent.Last();
        Assert.Equal("sipho@mail.example", codeEmail.To);
        var code = System.Text.RegularExpressions.Regex.Match(codeEmail.Text, "\\b\\d{6}\\b").Value;
        Assert.Equal(HttpStatusCode.OK, (await anyone.PostAsJsonAsync($"/api/document-links/{token}/verify", new { code })).StatusCode);
    }

    [Fact]
    public async Task A_PDF_that_failed_to_render_is_rendered_on_first_download()
    {
        var s = await Scheme();
        await PostedRun(s);
        api.Pdf.Failing = true;
        var res = await s.Finance.PostAsync($"/api/accounts/{s.Account42}/statements/2026-11/send", null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        // The email still goes (a portal link needs no PDF).
        await HumoApiFactory.Until(() => !api.Email.Sent.IsEmpty);
        Assert.Single(api.Email.Sent);
        Assert.Null(await api.Db(db => db.IssuedStatements.Select(x => x.Pdf).SingleAsync()));
        api.Pdf.Failing = false;
        var pdf = await s.Finance.GetAsync($"/api/accounts/{s.Account42}/statements/2026-11/pdf");
        Assert.StartsWith("%PDF", await pdf.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Templates_follow_the_plan_and_essentials_keeps_the_standard_layout()
    {
        var s = await Scheme("essentials");
        var templates = await Ok(await s.Admin.GetAsync("/api/documents/templates"));
        Assert.Contains(templates.EnumerateArray(), t => t.GetProperty("id").GetString() == "levy-statement.professional");
        Assert.Equal("Professional isn’t available on your plan.",
            (await (await s.Admin.PutAsJsonAsync("/api/documents/settings/defaults/levy-statement", new { templateId = "levy-statement.professional", expectedVersion = 0 })).FieldErrors()).GetProperty("templateId").GetString());
        Assert.True((await (await s.Admin.PutAsJsonAsync("/api/documents/settings/defaults/levy-statement", new { templateId = "invoice.standard", expectedVersion = 0 })).FieldErrors()).TryGetProperty("templateId", out _));
        Assert.Equal("forbidden", await (await s.Finance.PutAsJsonAsync("/api/documents/settings/defaults/levy-statement", new { templateId = "levy-statement.standard", expectedVersion = 0 })).ProblemCode());
    }

    [Fact]
    public async Task Agency_settings_billing_notifications_and_trust_accounts()
    {
        var s = await Scheme(withTrustAccount: false);
        var agency = await Ok(await s.Admin.GetAsync("/api/settings/agency"));
        Assert.Equal((0, 2m, 7), (agency.GetProperty("version").GetInt32(), agency.GetProperty("billing").GetProperty("interestRate").GetDecimal(), agency.GetProperty("billing").GetProperty("dueDay").GetInt32()));

        var details = new { name = "Acacia Property Management", shortName = "Acacia", registrationNumber = "2009/012345/07", vatNumber = (string?)null, ffcNumber = "2026/123", address = "12 Rivonia Rd", city = "Sandton", province = "Gauteng", email = "info@acacia.example", phone = "011 555 0100" };
        Assert.True((await (await s.Admin.PutAsJsonAsync("/api/settings/agency/details", new { details = details with { registrationNumber = "12345" }, expectedVersion = 0 })).FieldErrors()).TryGetProperty("registrationNumber", out _));
        await NoContent(await s.Admin.PutAsJsonAsync("/api/settings/agency/details", new { details, expectedVersion = 0 }));
        Assert.Equal("Acacia Property Management", await api.Db(db => db.Organisations.Select(o => o.Name).SingleAsync()));
        // Document contact details start from the agency's own.
        Assert.Equal("info@acacia.example", (await Ok(await s.Admin.GetAsync("/api/documents/settings"))).GetProperty("contact").GetProperty("email").GetString());

        // Billing: the interest rate is the one billing runs charge; the due day goes on statements.
        Assert.True((await (await s.Finance.PutAsJsonAsync("/api/settings/agency/billing", new { billing = new { interestRate = 9, billingDay = 25, dueDay = 7, stepDays = 14, agmMonths = 4 }, expectedVersion = 1 })).FieldErrors()).TryGetProperty("interestRate", out _));
        await NoContent(await s.Finance.PutAsJsonAsync("/api/settings/agency/billing", new { billing = new { interestRate = 1.5, billingDay = 20, dueDay = 5, stepDays = 14, agmMonths = 4 }, expectedVersion = 1 }));
        Assert.Equal(1.5m, await api.Db(db => db.Organisations.Select(o => o.InterestPercentPerMonth).SingleAsync()));
        Assert.Equal(HttpStatusCode.Conflict, (await s.Finance.PutAsJsonAsync("/api/settings/agency/billing", new { billing = new { interestRate = 2, billingDay = 20, dueDay = 5, stepDays = 14, agmMonths = 4 }, expectedVersion = 1 })).StatusCode);

        // Collection letters can't be switched off; channels must suit the event.
        Assert.True((await (await s.Admin.PutAsJsonAsync("/api/settings/agency/notifications", new { rules = new[] { new { @event = "collection-letter", enabled = false, channels = new[] { "email" } } }, expectedVersion = 2 })).FieldErrors()).TryGetProperty("collection-letter", out _));
        Assert.True((await (await s.Admin.PutAsJsonAsync("/api/settings/agency/notifications", new { rules = new[] { new { @event = "statement-issued", enabled = true, channels = new[] { "sms" } } }, expectedVersion = 2 })).FieldErrors()).TryGetProperty("statement-issued", out _));
        await NoContent(await s.Admin.PutAsJsonAsync("/api/settings/agency/notifications", new { rules = new[] { new { @event = "payment-received", enabled = false, channels = Array.Empty<string>() } }, expectedVersion = 2 }));
        var rules = (await Ok(await s.Admin.GetAsync("/api/settings/agency"))).GetProperty("notifications");
        Assert.Equal(("payment-received", false), (rules[0].GetProperty("event").GetString(), rules[0].GetProperty("enabled").GetBoolean()));

        // No statement goes out before owners know where to pay.
        var (run, runVersion) = await PostedRun(s);
        Assert.Equal(Humo.Api.Finance.StatementEndpoints.NoTrustAccount, (await (await Act(s.Finance, run, new { type = "send-statements" }, runVersion)).FieldErrors()).GetProperty("stage").GetString());
        Assert.True((await (await s.Finance.PostAsync($"/api/accounts/{s.Account42}/statements/2026-11/send", null)).FieldErrors()).TryGetProperty("period", out _));

        // The trust account owners pay into: a fresh passkey, and it shows on statements.
        var bank = new { bank = "FNB", accountName = "Kingfisher Court Body Corporate", accountNumber = "6234 5678 901", branchCode = "250655" };
        Assert.Equal("step-up-required", await (await s.Admin.PutAsJsonAsync($"/api/settings/trust-accounts/{s.Kc}", bank)).ProblemCode());
        await s.Admin.StepUp();
        Assert.True((await (await s.Admin.PutAsJsonAsync($"/api/settings/trust-accounts/{s.Kc}", bank with { branchCode = "25" })).FieldErrors()).TryGetProperty("branchCode", out _));
        await NoContent(await s.Admin.PutAsJsonAsync($"/api/settings/trust-accounts/{s.Kc}", bank));
        var trust = Assert.Single((await Ok(await s.Admin.GetAsync($"/api/settings/trust-accounts?schemeIds={s.Kc}"))).EnumerateArray());
        Assert.Equal(("62345678901", false), (trust.GetProperty("account").GetProperty("accountNumber").GetString(), trust.GetProperty("verified").GetBoolean()));
        Assert.Equal("forbidden", await (await s.Finance.PutAsJsonAsync($"/api/settings/trust-accounts/{s.Kc}", bank)).ProblemCode());

        await NoContent(await Act(s.Finance, run, new { type = "send-statements" }, runVersion));
        var statement = await Ok(await s.Finance.GetAsync($"/api/accounts/{s.Account42}/statements/2026-11"));
        Assert.Equal(("2026-11-05", "62345678901"), (statement.GetProperty("statement").GetProperty("dueOn").GetString(), statement.GetProperty("payTo").GetProperty("accountNumber").GetString()));
    }

    [Fact]
    public async Task People_set_their_own_notification_preferences()
    {
        var s = await Scheme();
        var prefs = await Ok(await s.Finance.GetAsync("/api/me/preferences"));
        Assert.Equal((0, "daily"), (prefs.GetProperty("version").GetInt32(), prefs.GetProperty("digest").GetString()));
        Assert.True((await (await s.Finance.PutAsJsonAsync("/api/me/preferences", new { work = Array.Empty<string>(), digest = "daily", expectedVersion = 0 })).FieldErrors()).TryGetProperty("work", out _));
        await NoContent(await s.Finance.PutAsJsonAsync("/api/me/preferences", new { work = new[] { "email", "push" }, digest = "weekly", quietFrom = "21:00", quietTo = "07:00", expectedVersion = 0 }));
        prefs = await Ok(await s.Finance.GetAsync("/api/me/preferences"));
        Assert.Equal(["email", "push"], prefs.GetProperty("work").EnumerateArray().Select(w => w.GetString()));
        // Someone else's are their own.
        Assert.Equal(0, (await Ok(await s.Admin.GetAsync("/api/me/preferences"))).GetProperty("version").GetInt32());
    }
}
