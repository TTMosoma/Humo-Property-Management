using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Scheme rules and the breach log (doc 15 §6, D29): rules change only by resolution, and the plan and role are enforced here.</summary>
public sealed class SchemeRulesTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private const string Wording = "Occupiers park only in the bays allocated to their section.";

    private record Setup(Guid Org, Guid Kc, Guid Unit, Guid Owner, HttpClient Admin);

    private async Task<Setup> Agency(string package = "professional")
    {
        var org = await api.Customer("Acacia", package);
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var unit = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "12", description = "3-bed", sizeM2 = 120, participationQuota = 2, monthlyLevy = 2400, occupancy = "owner-occupied" }));
        var owner = await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Sipho", lastName = "Khumalo", kind = "individual", email = "sipho@mail.example", phone = "083 551 0274", preferredChannel = "email" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = unit.ToString(), since = "2019-05-01" },
        }));
        return new Setup(org, kc, unit, owner, admin);
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static Task<HttpResponseMessage> Rule(HttpClient c, Guid scheme, object action) => c.PostAsJsonAsync($"/api/rules/{scheme}/actions", action);

    private static Task<Guid> AddRule(HttpClient c, Guid scheme, string number = "2.1") =>
        Rule(c, scheme, new { type = "add", number, title = "Parking", category = "parking", text = Wording }).ContinueWith(t => Id(t.Result)).Unwrap();

    private static Task<HttpResponseMessage> Breach(HttpClient c, Guid id, object action, int? version = null) =>
        c.PostAsJsonAsync($"/api/breaches/{id}/actions", new { action, expectedVersion = version });

    private static Task<Guid> Log(HttpClient c, Setup s, Guid rule) =>
        c.PostAsJsonAsync("/api/breaches", new { schemeId = s.Kc.ToString(), ruleId = rule.ToString(), unitId = s.Unit.ToString(), against = "owner", description = "Parked across two bays all week.", occurredAt = "2026-10-01" })
            .ContinueWith(t => Id(t.Result)).Unwrap();

    private static async Task<JsonElement> View(HttpClient c, Guid scheme) => await (await c.GetAsync($"/api/rules/{scheme}")).Json();

    [Fact]
    public async Task A_rule_changes_only_by_resolution_and_keeps_its_earlier_wording()
    {
        var s = await Agency();
        var rule = await AddRule(s.Admin, s.Kc);
        var captured = (await View(s.Admin, s.Kc)).GetProperty("rules")[0];
        Assert.Contains("Captured from the registered rules", captured.GetProperty("versions")[0].GetProperty("resolutionRef").GetString());

        const string changed = "Occupiers park only in their allocated bays, and never on the grass.";
        var bare = await Rule(s.Admin, s.Kc, new { type = "amend", ruleId = rule.ToString(), text = changed });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, bare.StatusCode);
        var future = await Rule(s.Admin, s.Kc, new { type = "amend", ruleId = rule.ToString(), text = changed, resolutionId = "", resolutionRef = "AGM 2030, resolution 1", adoptedOn = "2030-01-01" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, future.StatusCode);

        var typed = await Rule(s.Admin, s.Kc, new { type = "amend", ruleId = rule.ToString(), text = changed, resolutionId = "", resolutionRef = "AGM 12 March 2026, resolution 4", adoptedOn = "2026-03-12" });
        Assert.Equal(HttpStatusCode.NoContent, typed.StatusCode);
        var amended = (await View(s.Admin, s.Kc)).GetProperty("rules")[0];
        Assert.Equal(2, amended.GetProperty("versions").GetArrayLength());
        Assert.Equal(changed, amended.GetProperty("versions")[0].GetProperty("text").GetString());
        Assert.Equal("AGM 12 March 2026, resolution 4", amended.GetProperty("versions")[0].GetProperty("resolutionRef").GetString());
        Assert.Equal(Wording, amended.GetProperty("versions")[1].GetProperty("text").GetString());

        // A rule in force can't be added twice; repealing keeps it in the register.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Rule(s.Admin, s.Kc, new { type = "add", number = "2.1", title = "Parking", category = "parking", text = Wording })).StatusCode);
        var repeal = await Rule(s.Admin, s.Kc, new { type = "repeal", ruleId = rule.ToString(), resolutionId = "", resolutionRef = "AGM 12 March 2026, resolution 5", adoptedOn = "2026-03-12" });
        Assert.Equal(HttpStatusCode.NoContent, repeal.StatusCode);
        var repealed = (await View(s.Admin, s.Kc)).GetProperty("rules")[0];
        Assert.Equal("repealed", repealed.GetProperty("status").GetString());
        Assert.Equal("2026-03-12", repealed.GetProperty("repealed").GetProperty("at").GetString());
    }

    [Fact]
    public async Task A_resolution_from_the_register_must_be_a_passed_one_of_this_scheme()
    {
        var s = await Agency();
        var rule = await AddRule(s.Admin, s.Kc);
        var res = await api.Db(async db =>
        {
            var row = new ResolutionRow { Id = Guid.CreateVersion7(), OrganisationId = s.Org, SchemeId = s.Kc, Ref = "RES-KC-1", Number = 1, Outcome = "proposed",
                Json = JsonSerializer.Serialize(new { id = "x", @ref = "RES-KC-1", proposedAt = "2026-03-12T10:00:00+02:00" }, new JsonSerializerOptions(JsonSerializerDefaults.Web)) };
            row.Json = row.Json.Replace("\"x\"", $"\"{row.Id}\"");
            db.Resolutions.Add(row);
            await db.SaveChangesAsync();
            return row.Id;
        });
        const string changed = "Occupiers park only in their allocated bays, and never on the grass.";
        var proposed = await Rule(s.Admin, s.Kc, new { type = "amend", ruleId = rule.ToString(), text = changed, resolutionId = res.ToString() });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, proposed.StatusCode);

        await api.Db(async db =>
        {
            (await db.Resolutions.SingleAsync()).Outcome = "passed";
            await db.SaveChangesAsync();
            return 0;
        });
        Assert.Equal(HttpStatusCode.NoContent, (await Rule(s.Admin, s.Kc, new { type = "amend", ruleId = rule.ToString(), text = changed, resolutionId = res.ToString() })).StatusCode);
        var latest = (await View(s.Admin, s.Kc)).GetProperty("rules")[0].GetProperty("versions")[0];
        Assert.Equal("RES-KC-1", latest.GetProperty("resolutionRef").GetString());
        Assert.Equal("2026-03-12", latest.GetProperty("adoptedAt").GetString());
    }

    [Fact]
    public async Task Essentials_has_no_scheme_rules_even_by_calling_the_API_directly()
    {
        var s = await Agency("essentials");
        Assert.Equal("not-entitled", await (await s.Admin.GetAsync($"/api/rules/{s.Kc}")).ProblemCode());
        Assert.Equal("not-entitled", await (await s.Admin.GetAsync($"/api/breaches?schemeIds={s.Kc}")).ProblemCode());
        Assert.Equal("not-entitled", await (await Rule(s.Admin, s.Kc, new { type = "add", number = "1", title = "Pets", category = "pets", text = Wording })).ProblemCode());
    }

    [Fact]
    public async Task Sharing_prints_a_PDF_owners_can_see_and_replaces_the_copy_they_had()
    {
        var s = await Agency();
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Rule(s.Admin, s.Kc, new { type = "share" })).StatusCode);
        await AddRule(s.Admin, s.Kc);
        var first = await Id(await Rule(s.Admin, s.Kc, new { type = "share" }));
        var second = await Id(await Rule(s.Admin, s.Kc, new { type = "share" }));

        var docs = await api.Db(db => db.LibraryDocuments.Where(d => d.SchemeId == s.Kc).ToListAsync());
        Assert.NotNull(docs.Single(d => d.Id == first).ArchivedAt);
        var shared = docs.Single(d => d.Id == second);
        Assert.Null(shared.ArchivedAt);
        Assert.Equal(("owners", "rules"), (shared.Visibility, shared.Category));
        var book = (await View(s.Admin, s.Kc)).GetProperty("book");
        Assert.Equal(second.ToString(), book.GetProperty("shared").GetProperty("documentId").GetString());
        Assert.False(book.GetProperty("changedSinceShared").GetBoolean());
    }

    [Fact]
    public async Task A_rule_book_that_cant_be_printed_shares_nothing_and_says_so()
    {
        var s = await Agency();
        await AddRule(s.Admin, s.Kc);
        api.Pdf.Failing = true;
        var res = await Rule(s.Admin, s.Kc, new { type = "share" });
        Assert.Equal("render-failed", await res.ProblemCode());
        Assert.Empty(await api.Db(db => db.LibraryDocuments.Where(d => d.SchemeId == s.Kc).ToListAsync()));
    }

    [Fact]
    public async Task Text_in_a_rule_cant_become_markup_in_the_rule_book()
    {
        var s = await Agency();
        Assert.True((await Rule(s.Admin, s.Kc, new { type = "add", number = "1", title = "<script>alert(1)</script>", category = "other", text = "Rule text with <img src=x onerror=alert(1)> inside it." })).IsSuccessStatusCode);
        await Id(await Rule(s.Admin, s.Kc, new { type = "share" }));
        var file = await api.Db(db => db.UploadedFiles.SingleAsync(f => f.SchemeId == s.Kc));
        Assert.EndsWith(".pdf", file.Name);
        var html = Assert.Single(api.Pdf.Html);
        Assert.DoesNotContain("<script>", html);
        Assert.DoesNotContain("<img", html);
        Assert.Contains("&lt;script&gt;", html);
    }

    [Fact]
    public async Task A_warning_goes_by_email_with_its_date_raises_a_task_and_a_final_warning_needs_a_first()
    {
        var s = await Agency();
        var rule = await AddRule(s.Admin, s.Kc);
        var id = await Log(s.Admin, s, rule);
        const string letter = "Dear Sipho\n\nThe trustees have received a report about parking.\n\nKind regards\nOn behalf of the trustees";

        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Breach(s.Admin, id, new { type = "warn", final = true, remedyDays = 7, channel = "email", message = letter })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Breach(s.Admin, id, new { type = "warn", final = false, remedyDays = 14, channel = "email", message = letter })).StatusCode);

        var email = api.Email.Sent.Single(m => m.To == "sipho@mail.example");
        Assert.Contains("Please put this right by", email.Text);
        Assert.True(email.Text.IndexOf("Please put this right", StringComparison.Ordinal) < email.Text.IndexOf("Kind regards", StringComparison.Ordinal));
        var view = await (await s.Admin.GetAsync($"/api/breaches/{id}")).Json();
        var breach = view.GetProperty("breach");
        Assert.Equal("warned", breach.GetProperty("status").GetString());
        Assert.False(string.IsNullOrEmpty(breach.GetProperty("events")[1].GetProperty("sentId").GetString()));
        Assert.Equal("owner", view.GetProperty("personRole").GetString());
        var task = await api.Db(db => db.WorkItems.SingleAsync(w => w.SourceId == id && w.Status == "open"));
        Assert.EndsWith("-CHK", task.Ref);

        // A stale screen is refused.
        Assert.Equal(HttpStatusCode.Conflict, (await Breach(s.Admin, id, new { type = "note", text = "Old screen" }, 1)).StatusCode);

        // A repealed rule can't be left with open breaches.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Rule(s.Admin, s.Kc, new { type = "repeal", ruleId = rule.ToString(), resolutionId = "", resolutionRef = "AGM 2026, resolution 5", adoptedOn = "2026-03-12" })).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await Breach(s.Admin, id, new { type = "resolve", note = "The car was moved." })).StatusCode);
        Assert.Equal("done", (await api.Db(db => db.WorkItems.SingleAsync(w => w.SourceId == id))).Status);
    }

    [Fact]
    public async Task Someone_with_no_email_gets_their_warning_by_post_and_referring_raises_the_trustees_task()
    {
        var s = await Agency();
        var rule = await AddRule(s.Admin, s.Kc);
        await api.Db(async db =>
        {
            (await db.People.SingleAsync(p => p.Id == s.Owner)).Email = "";
            await db.SaveChangesAsync();
            return 0;
        });
        var id = await Log(s.Admin, s, rule);
        const string letter = "Dear Sipho, the trustees have received a report about parking.";
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Breach(s.Admin, id, new { type = "warn", final = false, remedyDays = 14, channel = "email", message = letter })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Breach(s.Admin, id, new { type = "warn", final = false, remedyDays = 14, channel = "post", message = letter })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Breach(s.Admin, id, new { type = "refer", note = "Still parked there after the warning." })).StatusCode);

        var tasks = await api.Db(db => db.WorkItems.Where(w => w.SourceId == id).ToListAsync());
        Assert.EndsWith("-TR", tasks.Single(w => w.Status == "open").Ref);
        Assert.Equal("done", tasks.Single(w => w.Ref.EndsWith("-CHK")).Status);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Breach(s.Admin, id, new { type = "warn", final = true, remedyDays = 7, channel = "post", message = letter })).StatusCode);
    }

    [Fact]
    public async Task A_breach_cites_a_rule_and_unit_of_its_own_scheme_and_another_agency_cant_reach_it()
    {
        var s = await Agency();
        var rule = await AddRule(s.Admin, s.Kc);
        var other = await Id(await s.Admin.PostAsJsonAsync("/api/schemes", new { name = "Die Eike", code = "DE", type = "Sectional Title", suburb = "Central", city = "Stellenbosch", province = "Western Cape" }));
        var crossed = await s.Admin.PostAsJsonAsync("/api/breaches", new { schemeId = other.ToString(), ruleId = rule.ToString(), unitId = s.Unit.ToString(), against = "owner", description = "Parked across two bays all week.", occurredAt = "2026-10-01" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, crossed.StatusCode);
        var id = await Log(s.Admin, s, rule);

        var fynbos = await api.Customer("Fynbos", "professional");
        await api.Person("annette@fynbos.example", Roles.AgencyAdmin, fynbos);
        var outsider = await api.SignedIn("annette@fynbos.example");
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/rules/{s.Kc}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/breaches/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Breach(outsider, id, new { type = "note", text = "Not mine" })).StatusCode);
    }

    [Fact]
    public async Task Finance_has_no_access_to_rules_breaches_or_warning_letters()
    {
        var s = await Agency();
        var rule = await AddRule(s.Admin, s.Kc);
        var id = await Log(s.Admin, s, rule);
        await api.Person("priya@acacia.example", Roles.Finance, s.Org);
        var finance = await api.SignedIn("priya@acacia.example");
        Assert.Equal("forbidden", await (await finance.GetAsync($"/api/breaches/{id}")).ProblemCode());
        Assert.Equal("forbidden", await (await finance.GetAsync($"/api/breaches?schemeIds={s.Kc}")).ProblemCode());
        Assert.Equal("forbidden", await (await finance.GetAsync($"/api/rules/{s.Kc}")).ProblemCode());
        Assert.Equal("forbidden", await (await Breach(finance, id, new { type = "note", text = "A note" })).ProblemCode());
        Assert.Equal("forbidden", await (await Rule(finance, s.Kc, new { type = "share" })).ProblemCode());

        // The warning letter is part of the breach; other things sent to the scheme still show.
        const string letter = "Dear Sipho\n\nThe trustees have received a report about parking.\n\nKind regards\nOn behalf of the trustees";
        Assert.Equal(HttpStatusCode.NoContent, (await Breach(s.Admin, id, new { type = "warn", final = false, remedyDays = 14, channel = "email", message = letter })).StatusCode);
        var sent = await s.Admin.GetAsync($"/api/communications/sent?schemeIds={s.Kc}");
        var message = Assert.Single((await sent.Json()).EnumerateArray()).GetProperty("message").GetProperty("id").GetString();
        Assert.Empty((await (await finance.GetAsync($"/api/communications/sent?schemeIds={s.Kc}")).Json()).EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await finance.GetAsync($"/api/communications/sent/{message}")).StatusCode);
    }

    [Fact]
    public async Task The_registered_rules_PDF_is_kept_with_its_history_and_a_staff_only_copy_leaves_what_owners_have()
    {
        var s = await Agency();
        var shared = await Id(await s.Admin.PostAsync($"/api/rules/{s.Kc}/upload", Form("2024-03-01", "Registered with the CSOS", true)));
        var staffOnly = await Id(await s.Admin.PostAsync($"/api/rules/{s.Kc}/upload", Form("2025-03-01", "AGM 2025, special resolution", false)));
        var book = (await View(s.Admin, s.Kc)).GetProperty("book");
        Assert.Equal(staffOnly.ToString(), book.GetProperty("sources")[0].GetProperty("documentId").GetString());
        Assert.Equal(2, book.GetProperty("sources").GetArrayLength());
        Assert.Equal(shared.ToString(), book.GetProperty("shared").GetProperty("documentId").GetString());
        var docs = await api.Db(db => db.LibraryDocuments.Where(d => d.SchemeId == s.Kc).ToListAsync());
        Assert.Null(docs.Single(d => d.Id == shared).ArchivedAt);
        Assert.Equal("staff", docs.Single(d => d.Id == staffOnly).Visibility);

        var replaced = await Id(await s.Admin.PostAsync($"/api/rules/{s.Kc}/upload", Form("2026-03-01", "AGM 2026, special resolution", true)));
        docs = await api.Db(db => db.LibraryDocuments.Where(d => d.SchemeId == s.Kc).ToListAsync());
        Assert.NotNull(docs.Single(d => d.Id == shared).ArchivedAt);
        Assert.Null(docs.Single(d => d.Id == replaced).ArchivedAt);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await s.Admin.PostAsync($"/api/rules/{s.Kc}/upload", Form("2030-03-01", "AGM 2030", true))).StatusCode);
    }

    private static MultipartFormDataContent Form(string adoptedOn, string reference, bool share)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(adoptedOn), "adoptedOn" },
            { new StringContent(reference), "resolutionRef" },
            { new StringContent(share ? "true" : "false"), "shareWithOwners" },
        };
        var file = new ByteArrayContent("%PDF-1.7 rules"u8.ToArray());
        file.Headers.ContentType = new("application/pdf");
        form.Add(file, "file", "rules.pdf");
        return form;
    }
}
