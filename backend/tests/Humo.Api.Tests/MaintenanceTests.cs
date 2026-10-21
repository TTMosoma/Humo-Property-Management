using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Maintenance on the API (slice 3a): a job from report to invoice, its approvals in My work, and the agency's suppliers.</summary>
public sealed class MaintenanceTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Org, Guid Kc, Guid Unit42, HttpClient Admin, HttpClient Trustee, HttpClient Owner, Guid AdminId);

    private async Task<Setup> Scheme(string package = "professional")
    {
        var org = await api.Customer("Acacia", package);
        var adminId = await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
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
        await api.Person("bongani@trustee.example", Roles.Trustee, org, [kc]);
        return new Setup(org, kc, u42, admin, await api.SignedIn("bongani@trustee.example"), await api.SignedIn("sipho@mail.example"), adminId);
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static async Task<string> Ref(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return (await res.Json()).GetProperty("id").GetString()!;
    }

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.OK, await res.Content.ReadAsStringAsync());
        return await res.Json();
    }

    private static async Task NoContent(HttpResponseMessage res) =>
        Assert.True(res.StatusCode == HttpStatusCode.NoContent, $"{res.StatusCode}: {await res.Content.ReadAsStringAsync()}");

    private static async Task<JsonElement> Job(HttpClient c, string reference) => (await Ok(await c.GetAsync($"/api/jobs/{reference}"))).GetProperty("job");

    private static async Task Act(HttpClient c, string reference, object action)
    {
        var version = (await Job(c, reference)).GetProperty("version").GetInt32();
        await NoContent(await c.PostAsJsonAsync($"/api/jobs/{reference}/actions", new { action, expectedVersion = version }));
    }

    private static async Task<JsonElement> Refused(HttpClient c, string reference, object action)
    {
        var version = (await Job(c, reference)).GetProperty("version").GetInt32();
        return await (await c.PostAsJsonAsync($"/api/jobs/{reference}/actions", new { action, expectedVersion = version })).FieldErrors();
    }

    private static Task<HttpResponseMessage> NewSupplier(HttpClient c, Guid scheme, string name = "Aqua Plumbing") => c.PostAsJsonAsync("/api/suppliers", new
    {
        name, trades = new[] { "Plumbing" }, contactName = "Peter Nel", phone = "082 555 0142", email = "jobs@aqua.example", schemeIds = new[] { scheme.ToString() },
    });

    [Fact]
    public async Task A_job_runs_from_report_to_invoice_within_delegated_authority()
    {
        var s = await Scheme();
        var supplier = await Id(await NewSupplier(s.Admin, s.Kc));
        var reference = await Ref(await s.Admin.PostAsJsonAsync("/api/jobs", new { schemeId = s.Kc.ToString(), location = "Block A stairwell", title = "Burst pipe in stairwell", description = "Water on the stairs.", category = "Plumbing", priority = "urgent" }));
        Assert.Equal("MR-1001", reference);
        Assert.Equal("open", await api.Db(db => db.WorkItems.Where(w => w.Type == "maintenance-triage").Select(w => w.Status).SingleAsync()));

        await Act(s.Admin, reference, new { type = "triage", assigneeId = s.AdminId.ToString(), priority = "urgent", category = "Plumbing" });
        Assert.Equal("done", await api.Db(db => db.WorkItems.Where(w => w.Type == "maintenance-triage").Select(w => w.Status).SingleAsync()));
        await Act(s.Admin, reference, new { type = "request-quotes", supplierIds = new[] { supplier.ToString() } });
        var quote = (await Job(s.Admin, reference)).GetProperty("quotes")[0].GetProperty("id").GetString();
        Assert.True((await Refused(s.Admin, reference, new { type = "approve-within-delegation", quoteId = quote })).TryGetProperty("quoteId", out _));
        await Act(s.Admin, reference, new { type = "record-quote", quoteId = quote, amount = 4_200, guaranteeMonths = 6 });
        await Act(s.Admin, reference, new { type = "approve-within-delegation", quoteId = quote });
        Assert.Equal(("approved", supplier.ToString()), ((await Job(s.Admin, reference)).GetProperty("stage").GetString(), (await Job(s.Admin, reference)).GetProperty("supplierId").GetString()));

        // Their vetting documents are missing: a work order needs an explicit override, recorded on the job.
        var tomorrow = api.Clock.GetUtcNow().AddDays(1).ToString("O");
        Assert.Contains("missing", (await Refused(s.Admin, reference, new { type = "issue-work-order", scheduledFor = tomorrow })).GetProperty("overrideVetting").GetString());
        await Act(s.Admin, reference, new { type = "issue-work-order", scheduledFor = tomorrow, accessNotes = "Caretaker has keys", overrideVetting = true });
        var job = await Job(s.Admin, reference);
        Assert.Equal("scheduled", job.GetProperty("stage").GetString());
        Assert.Contains(job.GetProperty("events").EnumerateArray(), e => e.GetProperty("text").GetString()!.StartsWith("Issued despite vetting"));

        await Act(s.Admin, reference, new { type = "start-work" });
        await Act(s.Admin, reference, new { type = "complete", notes = "Replaced 2 m of copper pipe" });
        Assert.True((await Refused(s.Admin, reference, new { type = "close" })).TryGetProperty("stage", out _));
        await Act(s.Admin, reference, new { type = "verify", outcome = "fixed", onBehalf = true });
        await Act(s.Admin, reference, new { type = "capture-invoice", amount = 4_200, invoiceNo = "INV-881" });
        var detail = await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"));
        Assert.Equal(("invoiced", "approved", "INV-881", 0m), (detail.GetProperty("job").GetProperty("stage").GetString(), detail.GetProperty("invoice").GetProperty("invoice").GetProperty("status").GetString(),
            detail.GetProperty("invoice").GetProperty("invoice").GetProperty("number").GetString(), detail.GetProperty("invoice").GetProperty("variance").GetDecimal()));

        // The supplier's record follows the job.
        var sup = await Ok(await s.Admin.GetAsync($"/api/suppliers/{supplier}"));
        Assert.Equal((1, "missing"), (sup.GetProperty("jobs").GetArrayLength(), sup.GetProperty("compliance").GetString()));
        Assert.Equal(1, sup.GetProperty("supplier").GetProperty("performance").GetProperty("jobsCompleted").GetInt32());
    }

    [Fact]
    public async Task Quotes_above_the_delegated_limit_go_to_the_trustees_and_an_invoice_over_the_quote_is_re_approved()
    {
        var s = await Scheme();
        var supplier = await Id(await NewSupplier(s.Admin, s.Kc));
        var reference = await Ref(await s.Admin.PostAsJsonAsync("/api/jobs", new { schemeId = s.Kc.ToString(), location = "Roof", title = "Roof leak over unit 42", description = "Ceiling stain.", category = "Plumbing", priority = "high" }));
        await Act(s.Admin, reference, new { type = "request-quotes", supplierIds = new[] { supplier.ToString() } });
        var quote = (await Job(s.Admin, reference)).GetProperty("quotes")[0].GetProperty("id").GetString();
        await Act(s.Admin, reference, new { type = "record-quote", quoteId = quote, amount = 18_500 });
        Assert.Contains("delegated limit", (await Refused(s.Admin, reference, new { type = "approve-within-delegation", quoteId = quote })).GetProperty("quoteId").GetString());
        await Act(s.Admin, reference, new { type = "send-for-approval", quoteId = quote });

        var approval = Assert.Single((await Ok(await s.Trustee.GetAsync("/api/work-items"))).EnumerateArray(), w => w.GetProperty("type").GetString() == "quote-approval");
        Assert.Contains("trustee", approval.GetProperty("approverRoles").EnumerateArray().Select(r => r.GetString()));
        await NoContent(await s.Trustee.PostAsJsonAsync($"/api/work-items/{approval.GetProperty("id").GetString()}/decision", new { decision = "approved", comment = "Go ahead" }));
        Assert.Equal("approved", (await Job(s.Admin, reference)).GetProperty("stage").GetString());

        await Act(s.Admin, reference, new { type = "issue-work-order", scheduledFor = api.Clock.GetUtcNow().AddDays(2).ToString("O"), overrideVetting = true });
        await Act(s.Admin, reference, new { type = "complete", notes = "Waterproofed the parapet" });
        // The owner confirms it on their own request's unit... this one is common property, so staff confirm.
        await Act(s.Admin, reference, new { type = "verify", outcome = "fixed", onBehalf = true });
        await Act(s.Admin, reference, new { type = "capture-invoice", amount = 19_200, invoiceNo = "R-2207" });
        var invoice = (await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("invoice");
        Assert.Equal(("awaiting-approval", 700m), (invoice.GetProperty("invoice").GetProperty("status").GetString(), invoice.GetProperty("variance").GetDecimal()));
        var reapproval = Assert.Single((await Ok(await s.Admin.GetAsync("/api/work-items"))).EnumerateArray(), w => w.GetProperty("type").GetString() == "invoice-approval");
        await NoContent(await s.Admin.PostAsJsonAsync($"/api/work-items/{reapproval.GetProperty("id").GetString()}/decision", new { decision = "approved" }));
        Assert.Equal("approved", (await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("invoice").GetProperty("invoice").GetProperty("status").GetString());
        Assert.True((await Refused(s.Admin, reference, new { type = "capture-invoice", amount = 100, invoiceNo = "R-2207" })).TryGetProperty("stage", out _));
    }

    [Fact]
    public async Task Residents_report_their_own_requests_and_confirm_them()
    {
        var s = await Scheme();
        var reference = await Ref(await s.Owner.PostAsJsonAsync("/api/jobs", new { title = "Geyser leaking", description = "Dripping since this morning.", category = "Plumbing" }));
        var job = await Job(s.Admin, reference);
        Assert.Equal(("owner", s.Unit42.ToString()), (job.GetProperty("reportedBy").GetProperty("role").GetString(), job.GetProperty("unitId").GetString()));
        Assert.Equal(reference, Assert.Single((await Ok(await s.Owner.GetAsync("/api/me/jobs"))).EnumerateArray()).GetProperty("job").GetProperty("ref").GetString());

        // Fixed in-house: no quotes needed.
        await Act(s.Admin, reference, new { type = "complete", notes = "Caretaker replaced the valve" });
        var version = (await Job(s.Admin, reference)).GetProperty("version").GetInt32();
        Assert.Equal(HttpStatusCode.NotFound, (await s.Owner.GetAsync($"/api/jobs/{reference}")).StatusCode);
        await NoContent(await s.Owner.PostAsJsonAsync($"/api/jobs/{reference}/actions", new { action = new { type = "verify", outcome = "not-fixed", comment = "Still dripping" }, expectedVersion = version }));
        Assert.Equal("reported", (await Job(s.Admin, reference)).GetProperty("stage").GetString());
        // Residents can't run the job.
        Assert.Equal(HttpStatusCode.NotFound, (await s.Owner.PostAsJsonAsync($"/api/jobs/{reference}/actions", new { action = new { type = "cancel", reason = "Never mind" }, expectedVersion = version + 1 })).StatusCode);
    }

    [Fact]
    public async Task Suppliers_on_hold_take_no_new_work_and_Essentials_tracks_jobs_without_quotes()
    {
        var s = await Scheme();
        var supplier = await Id(await NewSupplier(s.Admin, s.Kc));
        Assert.True((await (await NewSupplier(s.Admin, s.Kc)).FieldErrors()).TryGetProperty("name", out _));
        var reference = await Ref(await s.Admin.PostAsJsonAsync("/api/jobs", new { schemeId = s.Kc.ToString(), location = "Pool", title = "Pool pump noisy", description = "Grinding sound.", category = "Plumbing" }));
        await NoContent(await s.Admin.PostAsJsonAsync($"/api/suppliers/{supplier}/status", new { status = "on-hold", reason = "Insurance lapsed", expectedVersion = 1 }));
        Assert.Contains("on hold", (await Refused(s.Admin, reference, new { type = "request-quotes", supplierIds = new[] { supplier.ToString() } })).GetProperty("supplierIds").GetString());
        await NoContent(await s.Admin.PostAsJsonAsync($"/api/suppliers/{supplier}/status", new { status = "active", reason = "Insurance renewed", expectedVersion = 2 }));
        await Act(s.Admin, reference, new { type = "request-quotes", supplierIds = new[] { supplier.ToString() } });
        var quote = (await Job(s.Admin, reference)).GetProperty("quotes")[0].GetProperty("id").GetString();
        await Act(s.Admin, reference, new { type = "record-quote", quoteId = quote, amount = 1_200 });
        await Act(s.Admin, reference, new { type = "approve-within-delegation", quoteId = quote });
        Assert.Contains("open jobs", (await (await s.Admin.PostAsJsonAsync($"/api/suppliers/{supplier}/status", new { status = "archived", reason = "No longer used", expectedVersion = 3 })).FieldErrors()).GetProperty("status").GetString());
        Assert.Equal("step-up-required", await (await s.Admin.PostAsync($"/api/suppliers/{supplier}/bank-details", null)).ProblemCode());

        using var other = new HumoApiFactory();
        var org = await other.Customer("Small", "essentials");
        await other.Person("admin@small.example", Roles.AgencyAdmin, org);
        var admin = await other.SignedIn("admin@small.example");
        var scheme = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Bluegum", code = "BG", type = "Sectional Title", suburb = "Hatfield", city = "Pretoria", province = "Gauteng" }));
        var job = await Ref(await admin.PostAsJsonAsync("/api/jobs", new { schemeId = scheme.ToString(), location = "Gate", title = "Gate motor stuck", description = "Won't open.", category = "Gate automation" }));
        var v = (await Job(admin, job)).GetProperty("version").GetInt32();
        Assert.Equal("not-entitled", await (await admin.PostAsJsonAsync($"/api/jobs/{job}/actions", new { action = new { type = "request-quotes", supplierIds = new[] { Guid.NewGuid().ToString() } }, expectedVersion = v })).ProblemCode());
        await Act(admin, job, new { type = "complete", notes = "Reset the motor" });
        await Act(admin, job, new { type = "close" });
        Assert.Equal("closed", (await Job(admin, job)).GetProperty("stage").GetString());
    }
}
