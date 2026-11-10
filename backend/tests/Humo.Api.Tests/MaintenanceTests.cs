using Humo.Infrastructure.Data;
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
        var bongani = await api.Person("bongani@trustee.example", Roles.Trustee, org, [kc]);
        // On the board register (D2), so his decision counts for the board (D39). He's its only trustee: a majority of one.
        await api.Db(async db =>
        {
            var p = new Person { Id = Guid.CreateVersion7(), OrganisationId = org, FirstName = "Bongani", LastName = "Trustee", DisplayName = "Bongani Trustee", Initials = "BT",
                Email = "bongani@trustee.example", CreatedAt = api.Clock.GetUtcNow() };
            db.People.Add(p);
            db.Relationships.Add(new Relationship { Id = Guid.CreateVersion7(), PersonId = p.Id, Type = "trustee", SchemeId = kc, Portfolio = "Chairperson", Since = new DateOnly(2025, 3, 1) });
            (await db.Users.SingleAsync(u => u.Id == bongani)).PersonId = p.Id.ToString();
            return await db.SaveChangesAsync();
        });
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
    public async Task Finance_opens_a_job_from_its_invoice_but_cant_browse_or_log_them()
    {
        var s = await Scheme();
        var reference = await Ref(await s.Admin.PostAsJsonAsync("/api/jobs", new { schemeId = s.Kc.ToString(), location = "Block A stairwell", title = "Burst pipe in stairwell", description = "Water on the stairs.", category = "Plumbing", priority = "urgent" }));
        await api.Person("priya@acacia.example", Roles.Finance, s.Org);
        var finance = await api.SignedIn("priya@acacia.example");

        Assert.Equal(HttpStatusCode.OK, (await finance.GetAsync($"/api/jobs/{reference}")).StatusCode);
        Assert.Empty((await (await finance.GetAsync($"/api/jobs?schemeIds={s.Kc}")).Json()).GetProperty("items").EnumerateArray());
        Assert.Empty((await (await finance.GetAsync($"/api/jobs/search?q=burst&schemeIds={s.Kc}")).Json()).EnumerateArray());
        var log = await finance.PostAsJsonAsync("/api/jobs", new { schemeId = s.Kc.ToString(), location = "Roof", title = "Roof leak", description = "Drip.", category = "Plumbing", priority = "normal" });
        Assert.Equal("forbidden", await log.ProblemCode());
    }

    // ---------------------------------------------------------------- Photos (stored, scanned and counted)

    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, (byte)'J', (byte)'F', (byte)'I', (byte)'F', 0x00, 0x01, 0xFF, 0xD9];

    private static MultipartFormDataContent Photo(byte[] bytes, string name = "ceiling.jpg", string? stage = null, string? caption = null)
    {
        var form = new MultipartFormDataContent { { new ByteArrayContent(bytes), "file", name } };
        if (stage is not null) form.Add(new StringContent(stage), "stage");
        if (caption is not null) form.Add(new StringContent(caption), "caption");
        return form;
    }

    private async Task<string> NewJob(Setup s) =>
        await Ref(await s.Admin.PostAsJsonAsync("/api/jobs", new { schemeId = s.Kc.ToString(), unitId = s.Unit42.ToString(), location = "Kitchen", title = "Geyser leaking", description = "Dripping.", category = "Plumbing", priority = "normal" }));

    private async Task<long> StoredBytes(Setup s) =>
        (await Ok(await s.Admin.GetAsync($"/api/organisations/{s.Org}/plan"))).GetProperty("storage").GetProperty("usedBytes").GetInt64();

    [Fact]
    public async Task A_photo_is_stored_shown_on_the_job_and_counted_against_storage()
    {
        var s = await Scheme();
        var reference = await NewJob(s);
        var before = await StoredBytes(s);

        Assert.Equal(HttpStatusCode.Created, (await s.Admin.PostAsync($"/api/jobs/{reference}/photos", Photo(Jpeg, caption: "Stain on the ceiling"))).StatusCode);

        var photo = Assert.Single((await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("job").GetProperty("photos").EnumerateArray());
        Assert.Equal(("Stain on the ceiling", "report"), (photo.GetProperty("caption").GetString(), photo.GetProperty("stage").GetString()));
        Assert.False(string.IsNullOrEmpty(photo.GetProperty("fileId").GetString()));
        var image = await s.Admin.GetAsync($"/api/jobs/{reference}/photos/{photo.GetProperty("id").GetString()}");
        Assert.Equal("image/jpeg", image.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Jpeg, await image.Content.ReadAsByteArrayAsync());
        Assert.Equal(before + Jpeg.Length, await StoredBytes(s));
    }

    [Fact]
    public async Task Only_clean_images_are_stored()
    {
        var s = await Scheme();
        var reference = await NewJob(s);
        var heic = new byte[] { 0, 0, 0, 0x18, (byte)'f', (byte)'t', (byte)'y', (byte)'p', (byte)'h', (byte)'e', (byte)'i', (byte)'c', 0, 0 };

        Assert.Contains("JPEG, PNG or WebP", (await (await s.Admin.PostAsync($"/api/jobs/{reference}/photos", Photo("%PDF-1.7"u8.ToArray(), "photo.jpg"))).FieldErrors()).GetProperty("file").GetString());
        Assert.Contains("HEIC", (await (await s.Admin.PostAsync($"/api/jobs/{reference}/photos", Photo(heic, "IMG_1.heic"))).FieldErrors()).GetProperty("file").GetString());
        Assert.Equal("infected", await (await s.Admin.PostAsync($"/api/jobs/{reference}/photos", Photo([.. Jpeg, .. "EICAR-STANDARD-ANTIVIRUS-TEST-FILE"u8.ToArray()]))).ProblemCode());

        Assert.Empty((await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("job").GetProperty("photos").EnumerateArray());
        Assert.Equal(0, await api.Db(db => db.UploadedFiles.CountAsync()));
    }

    [Fact]
    public async Task A_resident_adds_photos_to_their_own_request_but_not_of_the_finished_work()
    {
        var s = await Scheme();
        var reference = await Ref(await s.Owner.PostAsJsonAsync("/api/jobs", new { title = "Geyser leaking", description = "Dripping since this morning.", category = "Plumbing" }));

        Assert.Equal(HttpStatusCode.Created, (await s.Owner.PostAsync($"/api/jobs/{reference}/photos", Photo(Jpeg, stage: "completion"))).StatusCode);

        var photo = Assert.Single((await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("job").GetProperty("photos").EnumerateArray());
        Assert.Equal("report", photo.GetProperty("stage").GetString());
        Assert.Equal(HttpStatusCode.OK, (await s.Owner.GetAsync($"/api/jobs/{reference}/photos/{photo.GetProperty("id").GetString()}")).StatusCode);

        // Someone else's job isn't theirs to add to or look at.
        var other = await NewJob(s);
        await api.Db(async db =>
        {
            (await db.Jobs.SingleAsync(j => j.Ref == other)).UnitId = null;
            return await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.NotFound, (await s.Owner.PostAsync($"/api/jobs/{other}/photos", Photo(Jpeg))).StatusCode);
    }

    [Fact]
    public async Task Removing_a_photo_deletes_its_file_and_frees_the_storage()
    {
        var s = await Scheme();
        var reference = await NewJob(s);
        var before = await StoredBytes(s);
        await s.Admin.PostAsync($"/api/jobs/{reference}/photos", Photo(Jpeg));
        var photo = Assert.Single((await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("job").GetProperty("photos").EnumerateArray()).GetProperty("id").GetString();

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.DeleteAsync($"/api/jobs/{reference}/photos/{photo}")).StatusCode);

        Assert.Empty((await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("job").GetProperty("photos").EnumerateArray());
        Assert.Equal(before, await StoredBytes(s));
        Assert.Equal(0, await api.Db(db => db.UploadedFiles.CountAsync()));
        Assert.Single(await api.Db(db => db.Audit.Where(a => a.Action.StartsWith($"Removed a photo from {reference}")).ToListAsync()));
    }

    [Fact]
    public async Task A_resident_removes_only_photos_they_added()
    {
        var s = await Scheme();
        var reference = await Ref(await s.Owner.PostAsJsonAsync("/api/jobs", new { title = "Geyser leaking", description = "Dripping since this morning.", category = "Plumbing" }));
        await s.Owner.PostAsync($"/api/jobs/{reference}/photos", Photo(Jpeg, "mine.jpg"));
        await s.Admin.PostAsync($"/api/jobs/{reference}/photos", Photo(Jpeg, "staff.jpg"));
        var photos = (await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("job").GetProperty("photos").EnumerateArray().Select(p => p.GetProperty("id").GetString()).ToList();

        Assert.Equal(HttpStatusCode.NotFound, (await s.Owner.DeleteAsync($"/api/jobs/{reference}/photos/{photos[1]}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await s.Owner.DeleteAsync($"/api/jobs/{reference}/photos/{photos[0]}")).StatusCode);
        Assert.Single((await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("job").GetProperty("photos").EnumerateArray());
    }

    [Fact]
    public async Task Completing_a_job_no_longer_adds_a_photo_that_isnt_there()
    {
        var s = await Scheme();
        var reference = await NewJob(s);
        await api.Db(async db =>
        {
            var row = await db.Jobs.SingleAsync(j => j.Ref == reference);
            var job = Humo.Api.Maintenance.MaintenanceService.Read(row);
            job.Stage = "in-progress";
            Humo.Api.Maintenance.MaintenanceService.Write(row, job);
            return await db.SaveChangesAsync();
        });

        var done = await s.Admin.PostAsJsonAsync($"/api/jobs/{reference}/actions", new { action = new { type = "complete", notes = "Replaced the valve." } });
        Assert.True(done.IsSuccessStatusCode, await done.Content.ReadAsStringAsync());

        Assert.Empty((await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("job").GetProperty("photos").EnumerateArray());
    }

    [Fact]
    public async Task A_job_offers_the_scheme_s_suppliers_of_every_trade_so_triage_can_change_it()
    {
        var s = await Scheme();
        var plumber = await Id(await NewSupplier(s.Admin, s.Kc));
        var roofer = await Id(await s.Admin.PostAsJsonAsync("/api/suppliers", new
        {
            name = "Top Roofs", trades = new[] { "Roofing & waterproofing" }, contactName = "Lerato Dube", phone = "082 555 0199", email = "jobs@roofs.example", schemeIds = new[] { s.Kc.ToString() },
        }));
        var elsewhere = await Id(await s.Admin.PostAsJsonAsync("/api/schemes", new { name = "Die Eike", code = "DE", type = "Sectional Title", suburb = "Brooklyn", city = "Pretoria", province = "Gauteng" }));
        var away = await Id(await NewSupplier(s.Admin, elsewhere, "Far Plumbing"));
        var reference = await NewJob(s);

        var candidates = (await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("candidates").EnumerateArray().Select(c => c.GetProperty("id").GetString()).ToList();
        Assert.Contains(plumber.ToString(), candidates);
        Assert.Contains(roofer.ToString(), candidates);
        Assert.DoesNotContain(away.ToString(), candidates);
    }

    private static MultipartFormDataContent VettingDoc(Guid supplier, string type, string? expires)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent("supplier"), "recordKind" }, { new StringContent(supplier.ToString()), "recordId" }, { new StringContent(type), "title" },
            { new StringContent("vetting"), "category" }, { new StringContent("staff"), "visibility" }, { new StringContent(type), "supplierDoc" },
            { new ByteArrayContent(System.Text.Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n")), "file", "doc.pdf" },
        };
        if (expires is not null) form.Add(new StringContent(expires), "expiresAt");
        return form;
    }

    [Fact]
    public async Task A_supplier_with_no_document_records_isnt_vetted_and_the_work_order_says_so()
    {
        var s = await Scheme();
        var supplier = await Id(await NewSupplier(s.Admin, s.Kc));
        await api.Db(async db => { (await db.Suppliers.SingleAsync(x => x.Id == supplier)).Documents = "[]"; return await db.SaveChangesAsync(); });

        var detail = await Ok(await s.Admin.GetAsync($"/api/suppliers/{supplier}"));
        Assert.Equal("missing", detail.GetProperty("compliance").GetString());
        Assert.Equal(5, detail.GetProperty("supplier").GetProperty("documents").GetArrayLength());

        var reference = await NewJob(s);
        await Act(s.Admin, reference, new { type = "triage", assigneeId = s.AdminId.ToString(), priority = "normal", category = "Plumbing" });
        await Act(s.Admin, reference, new { type = "request-quotes", supplierIds = new[] { supplier.ToString() } });
        var quote = (await Job(s.Admin, reference)).GetProperty("quotes")[0].GetProperty("id").GetString();
        await Act(s.Admin, reference, new { type = "record-quote", quoteId = quote, amount = 1_000 });
        await Act(s.Admin, reference, new { type = "approve-within-delegation", quoteId = quote });
        Assert.Contains("missing", (await Refused(s.Admin, reference, new { type = "issue-work-order", scheduledFor = api.Clock.GetUtcNow().AddDays(1).ToString("O") })).GetProperty("overrideVetting").GetString());
    }

    [Fact]
    public async Task Uploading_every_vetting_document_vets_the_supplier_and_a_lapsing_one_needs_its_date()
    {
        var s = await Scheme();
        var supplier = await Id(await NewSupplier(s.Admin, s.Kc));
        var later = api.Clock.GetUtcNow().AddYears(1).ToString("yyyy-MM-dd");

        Assert.True((await (await s.Admin.PostAsync("/api/documents/library", VettingDoc(supplier, "Public liability insurance", null))).FieldErrors()).TryGetProperty("expiresAt", out _));
        foreach (var type in new[] { "COIDA letter of good standing", "Public liability insurance", "Tax compliance (SARS PIN)" })
            Assert.Equal(HttpStatusCode.OK, (await s.Admin.PostAsync("/api/documents/library", VettingDoc(supplier, type, later))).StatusCode);
        Assert.Equal("missing", (await Ok(await s.Admin.GetAsync($"/api/suppliers/{supplier}"))).GetProperty("compliance").GetString());
        var bank = await s.Admin.PostAsync("/api/documents/library", VettingDoc(supplier, "Bank confirmation letter", null));
        Assert.Equal(HttpStatusCode.OK, bank.StatusCode);
        Assert.Equal("valid", (await Ok(await s.Admin.GetAsync($"/api/suppliers/{supplier}"))).GetProperty("compliance").GetString());

        // The file behind the status stands until it's replaced.
        var id = (await bank.Json()).GetProperty("id").GetString();
        var version = (await Ok(await s.Admin.GetAsync($"/api/documents/library/{id}"))).GetProperty("version").GetInt32();
        var archive = await s.Admin.PostAsJsonAsync($"/api/documents/library/{id}/actions", new { type = "archive", expectedVersion = version, reason = "Gone" });
        Assert.True((await archive.FieldErrors()).TryGetProperty("id", out _));
    }

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
        Assert.Contains("scheme’s limit", (await Refused(s.Admin, reference, new { type = "approve-within-delegation", quoteId = quote })).GetProperty("quoteId").GetString());
        await Act(s.Admin, reference, new { type = "send-for-approval", quoteId = quote });

        var approval = Assert.Single((await Ok(await s.Trustee.GetAsync("/api/work-items"))).EnumerateArray(), w => w.GetProperty("type").GetString() == "quote-approval");
        Assert.Equal(["trustee"], approval.GetProperty("approverRoles").EnumerateArray().Select(r => r.GetString()));
        // D39: the agency recommends; it doesn't approve spending above the limit, not even the person who sent it.
        Assert.Equal("forbidden", await (await s.Admin.PostAsJsonAsync($"/api/work-items/{approval.GetProperty("id").GetString()}/decision", new { decision = "approved" })).ProblemCode());
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
        // Above its quote and above the limit: the board's too.
        Assert.Equal("forbidden", await (await s.Admin.PostAsJsonAsync($"/api/work-items/{reapproval.GetProperty("id").GetString()}/decision", new { decision = "approved" })).ProblemCode());
        await NoContent(await s.Trustee.PostAsJsonAsync($"/api/work-items/{reapproval.GetProperty("id").GetString()}/decision", new { decision = "approved" }));
        Assert.Equal("approved", (await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("invoice").GetProperty("invoice").GetProperty("status").GetString());
        Assert.True((await Refused(s.Admin, reference, new { type = "capture-invoice", amount = 100, invoiceNo = "R-2207" })).TryGetProperty("stage", out _));
    }

    private async Task<(string Reference, string Quote, Guid Supplier)> QuotedJob(Setup s, decimal amount, string priority = "urgent")
    {
        var supplier = await Id(await NewSupplier(s.Admin, s.Kc));
        var reference = await Ref(await s.Admin.PostAsJsonAsync("/api/jobs", new { schemeId = s.Kc.ToString(), location = "Block A", title = "Burst pipe in roof", description = "Water through the ceiling.", category = "Plumbing", priority }));
        await Act(s.Admin, reference, new { type = "request-quotes", supplierIds = new[] { supplier.ToString() } });
        var quote = (await Job(s.Admin, reference)).GetProperty("quotes")[0].GetProperty("id").GetString()!;
        await Act(s.Admin, reference, new { type = "record-quote", quoteId = quote, amount });
        return (reference, quote, supplier);
    }

    [Fact]
    public async Task Each_scheme_sets_its_own_limit_with_a_passkey()
    {
        var s = await Scheme();
        Assert.Equal("step-up-required", await (await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/delegated-limit", new { limit = 20_000 })).ProblemCode());
        await s.Admin.StepUp();
        await NoContent(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/delegated-limit", new { limit = 20_000 }));
        Assert.Equal(20_000m, (await Ok(await s.Admin.GetAsync($"/api/schemes/{s.Kc}"))).GetProperty("delegatedLimit").GetDecimal());

        var (reference, quote, _) = await QuotedJob(s, 18_500, "normal");
        await Act(s.Admin, reference, new { type = "approve-within-delegation", quoteId = quote });
        Assert.Equal("approved", (await Job(s.Admin, reference)).GetProperty("stage").GetString());
    }

    [Fact]
    public async Task Emergency_work_goes_ahead_but_isnt_paid_until_the_board_confirms_it()
    {
        var s = await Scheme();
        var (reference, quote, supplier) = await QuotedJob(s, 9_000);
        Assert.True((await Refused(s.Admin, reference, new { type = "emergency-proceed", quoteId = quote })).TryGetProperty("reason", out _));
        var noPasskey = await s.Admin.PostAsJsonAsync($"/api/jobs/{reference}/actions",
            new { action = new { type = "emergency-proceed", quoteId = quote, reason = "Water is pouring into Unit 4" }, expectedVersion = (await Job(s.Admin, reference)).GetProperty("version").GetInt32() });
        Assert.Equal("step-up-required", await noPasskey.ProblemCode());

        await s.Admin.StepUp();
        await Act(s.Admin, reference, new { type = "emergency-proceed", quoteId = quote, reason = "Water is pouring into Unit 4" });
        var job = await Job(s.Admin, reference);
        Assert.Equal(("approved", "to-confirm"), (job.GetProperty("stage").GetString(), job.GetProperty("emergency").GetProperty("status").GetString()));
        await HumoApiFactory.Until(() => api.Email.Sent.Any(x => x.To == "bongani@trustee.example" && x.Subject.StartsWith("Emergency work above the limit")));

        await Act(s.Admin, reference, new { type = "issue-work-order", scheduledFor = api.Clock.GetUtcNow().AddDays(1).ToString("O"), overrideVetting = true });
        await Act(s.Admin, reference, new { type = "complete", notes = "Replaced the pipe" });
        await Act(s.Admin, reference, new { type = "verify", outcome = "fixed", onBehalf = true });
        await Act(s.Admin, reference, new { type = "capture-invoice", amount = 9_000, invoiceNo = "E-1" });
        await api.Db(async db => { (await db.Suppliers.SingleAsync(x => x.Id == supplier)).BankVerified = true; return await db.SaveChangesAsync(); });
        var invoice = (await Ok(await s.Admin.GetAsync($"/api/jobs/{reference}"))).GetProperty("invoice").GetProperty("invoice").GetProperty("id").GetString();
        var held = await s.Admin.PostAsJsonAsync("/api/payables/batches", new { invoiceIds = new[] { invoice } });
        Assert.Contains("emergency", (await held.FieldErrors()).GetProperty("invoiceIds").GetString());

        var confirm = Assert.Single((await Ok(await s.Trustee.GetAsync("/api/work-items"))).EnumerateArray(), w => w.GetProperty("type").GetString() == "quote-approval");
        await NoContent(await s.Trustee.PostAsJsonAsync($"/api/work-items/{confirm.GetProperty("id").GetString()}/decision", new { decision = "approved" }));
        Assert.Equal("confirmed", (await Job(s.Admin, reference)).GetProperty("emergency").GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.Created, (await s.Admin.PostAsJsonAsync("/api/payables/batches", new { invoiceIds = new[] { invoice } })).StatusCode);
    }

    [Fact]
    public async Task A_signed_approval_is_refused_if_it_predates_the_item_or_names_someone_off_the_board()
    {
        var s = await Scheme();
        var (reference, quote, _) = await QuotedJob(s, 18_500, "normal");
        await Act(s.Admin, reference, new { type = "send-for-approval", quoteId = quote });
        var item = (await Job(s.Admin, reference)).GetProperty("approval").GetProperty("workItemId").GetString();
        var bongani = await api.Db(db => db.People.Where(p => p.Email == "bongani@trustee.example").Select(p => p.Id).SingleAsync());
        MultipartFormDataContent Signed(Guid who, DateTimeOffset on) => new()
        {
            { new StringContent(who.ToString()), "signers" }, { new StringContent(on.ToString("yyyy-MM-dd")), "signedOn" },
            { new ByteArrayContent(System.Text.Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF\n")), "file", "approval.pdf" },
        };
        await s.Admin.StepUp();
        Assert.True((await (await s.Admin.PostAsync($"/api/work-items/{item}/board-approval", Signed(bongani, api.Clock.GetUtcNow().AddDays(-10)))).FieldErrors()).TryGetProperty("signedOn", out _));
        Assert.True((await (await s.Admin.PostAsync($"/api/work-items/{item}/board-approval", Signed(Guid.NewGuid(), api.Clock.GetUtcNow()))).FieldErrors()).TryGetProperty("signers", out _));
        Assert.Equal("approval", (await Job(s.Admin, reference)).GetProperty("stage").GetString());
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
        Assert.Equal("step-up-required", await (await s.Admin.PostAsJsonAsync($"/api/suppliers/{supplier}/bank-details", new { bankName = "FNB", branchCode = "250655", accountNumber = "62012345678", accountType = "cheque", accountHolder = "Aqua Plumbing" })).ProblemCode());

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
