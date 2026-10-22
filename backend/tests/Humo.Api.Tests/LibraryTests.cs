using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>The document library on the API (docs/18 R-11): upload, reading, edits, archive and restore, and opening.</summary>
public sealed class LibraryTests : IDisposable
{
    private readonly HumoApiFactory api = new HumoApiFactory().With("Files:MaxBytes", "4096");

    public void Dispose() => api.Dispose();

    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

    private sealed record Setup(HttpClient Admin, Guid Kc, Guid Riverside, Guid Org);

    private async Task<Setup> Scheme()
    {
        var org = await api.Customer("Acacia", "professional");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var riverside = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Riverside Estate", code = "RV", type = "Sectional Title", suburb = "Sandton", city = "Sandton", province = "Gauteng" }));
        return new Setup(admin, kc, riverside, org);
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Json();
    }

    private static MultipartFormDataContent Form(Guid schemeId, string title = "Building insurance 2027", string category = "insurance", string visibility = "trustees",
        string? expiresAt = "2027-03-31", byte[]? content = null, string fileName = "insurance.pdf")
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(schemeId.ToString()), "schemeId" },
            { new StringContent(title), "title" },
            { new StringContent(category), "category" },
            { new StringContent(visibility), "visibility" },
        };
        if (expiresAt is not null) form.Add(new StringContent(expiresAt), "expiresAt");
        var file = new ByteArrayContent(content ?? Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        form.Add(file, "file", fileName);
        return form;
    }

    private static async Task<string> Upload(HttpClient admin, Guid scheme, string title = "Building insurance 2027")
    {
        var res = await admin.PostAsync("/api/documents/library", Form(scheme, title: title));
        return (await Ok(res)).GetProperty("id").GetString()!;
    }

    private static object Edit(int version, string title = "Building insurance 2027", string category = "insurance", string visibility = "trustees", string? expiresAt = "2027-03-31") =>
        new { type = "edit", expectedVersion = version, title, category, visibility, expiresAt, notes = "Renewed in October" };

    [Fact]
    public async Task A_document_is_uploaded_with_its_details_and_listed_on_its_scheme()
    {
        var s = await Scheme();
        var id = await Upload(s.Admin, s.Kc);

        var list = await Ok(await s.Admin.GetAsync($"/api/documents/library?schemeIds={s.Kc}"));
        var doc = Assert.Single(list.EnumerateArray());
        Assert.Equal(("Building insurance 2027", "insurance", "trustees", "2027-03-31"), (doc.GetProperty("title").GetString(), doc.GetProperty("category").GetString(),
            doc.GetProperty("visibility").GetString(), doc.GetProperty("expiresAt").GetString()));
        Assert.Equal(("insurance.pdf", "application/pdf", 1), (doc.GetProperty("fileName").GetString(), doc.GetProperty("mimeType").GetString(), doc.GetProperty("version").GetInt32()));
        Assert.Equal("Kingfisher Court", doc.GetProperty("links")[0].GetProperty("label").GetString());

        var one = await Ok(await s.Admin.GetAsync($"/api/documents/library/{id}"));
        Assert.Equal(id, one.GetProperty("id").GetString());
        var record = await Ok(await s.Admin.GetAsync($"/api/documents/library?record=scheme:{s.Kc}"));
        Assert.Single(record.EnumerateArray());
    }

    [Fact]
    public async Task Missing_or_wrong_details_are_refused_with_the_field_named()
    {
        var s = await Scheme();
        var res = await s.Admin.PostAsync("/api/documents/library", Form(s.Kc, title: "", category: "gardening", visibility: "everyone", expiresAt: "31/03/2027"));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        var errors = await res.FieldErrors();
        Assert.Equal(new[] { "title", "category", "visibility", "expiresAt" }, errors.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal(0, await api.Db(db => db.LibraryDocuments.CountAsync()));
    }

    [Fact]
    public async Task An_edit_needs_the_current_version()
    {
        var s = await Scheme();
        var id = await Upload(s.Admin, s.Kc);
        Assert.Equal(HttpStatusCode.Conflict, (await s.Admin.PostAsJsonAsync($"/api/documents/library/{id}/actions", Edit(version: 7))).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/documents/library/{id}/actions", Edit(version: 1, title: "Insurance renewal"))).StatusCode);
        var doc = await Ok(await s.Admin.GetAsync($"/api/documents/library/{id}"));
        Assert.Equal(("Insurance renewal", 2), (doc.GetProperty("title").GetString(), doc.GetProperty("version").GetInt32()));
    }

    [Fact]
    public async Task A_document_is_archived_with_a_reason_and_restored()
    {
        var s = await Scheme();
        var id = await Upload(s.Admin, s.Kc);
        var noReason = await s.Admin.PostAsJsonAsync($"/api/documents/library/{id}/actions", new { type = "archive", expectedVersion = 1, reason = " " });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, noReason.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/documents/library/{id}/actions", new { type = "archive", expectedVersion = 1, reason = "Replaced by the 2028 policy" })).StatusCode);
        var archived = (await Ok(await s.Admin.GetAsync($"/api/documents/library/{id}"))).GetProperty("archived");
        Assert.Equal("Replaced by the 2028 policy", archived.GetProperty("reason").GetString());
        Assert.False(string.IsNullOrEmpty(archived.GetProperty("by").GetString()));

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/documents/library/{id}/actions", new { type = "restore", expectedVersion = 2 })).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await Ok(await s.Admin.GetAsync($"/api/documents/library/{id}"))).GetProperty("archived").ValueKind);
    }

    [Fact]
    public async Task A_scheme_the_person_does_not_cover_is_not_listed_or_opened()
    {
        var s = await Scheme();
        var id = await Upload(s.Admin, s.Kc);
        await api.Person("sizwe@acacia.example", Roles.AgencyAdmin, s.Org, [s.Riverside]);
        var outsider = await api.SignedIn("sizwe@acacia.example");

        Assert.Empty((await Ok(await outsider.GetAsync($"/api/documents/library?schemeIds={s.Kc}"))).EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/documents/library/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/documents/library/{id}/link")).StatusCode);
    }

    [Fact]
    public async Task The_link_opens_the_stored_pdf()
    {
        var s = await Scheme();
        var id = await Upload(s.Admin, s.Kc);
        var link = (await Ok(await s.Admin.GetAsync($"/api/documents/library/{id}/link"))).GetProperty("url").GetString()!;
        var content = await s.Admin.GetAsync(link);
        Assert.Equal(HttpStatusCode.OK, content.StatusCode);
        Assert.Equal(Pdf, await content.Content.ReadAsByteArrayAsync());
    }

    // ---- Units, and what's shared with trustees, owners and tenants ----

    private static MultipartFormDataContent On(string kind, Guid recordId, string title, string category, string visibility, byte[]? content = null)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(kind), "recordKind" },
            { new StringContent(recordId.ToString()), "recordId" },
            { new StringContent(title), "title" },
            { new StringContent(category), "category" },
            { new StringContent(visibility), "visibility" },
        };
        var file = new ByteArrayContent(content ?? Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        form.Add(file, "file", "doc.pdf");
        return form;
    }

    private async Task<Guid> Unit(Setup s, string number)
    {
        var res = await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", new { number, description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1800, occupancy = "owner-occupied" });
        return await Id(res);
    }

    /// <summary>A person with a relationship to Kingfisher Court (and a unit, if given), signed in.</summary>
    private async Task<HttpClient> Resident(Setup s, string email, string type, Guid? unit = null)
    {
        await api.Person(email, type == "trustee" ? Roles.Trustee : Roles.Owner, s.Org, [s.Kc]);
        var personId = Guid.CreateVersion7();
        await api.Db(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Email == email);
            db.People.Add(new Person
            {
                Id = personId, OrganisationId = s.Org, FirstName = "Resident", LastName = "Test", Kind = "individual", DisplayName = email, Initials = "RT",
                Email = email, Phone = "", PreferredChannel = "email", CreatedAt = DateTimeOffset.UtcNow,
            });
            db.Relationships.Add(new Relationship { Id = Guid.CreateVersion7(), PersonId = personId, Type = type, SchemeId = s.Kc, UnitId = unit, Since = new DateOnly(2020, 1, 1) });
            user.PersonId = personId.ToString();
            return await db.SaveChangesAsync();
        });
        return await api.SignedIn(email);
    }

    private static async Task<List<string>> Titles(HttpClient client) =>
        (await Ok(await client.GetAsync("/api/documents/library/mine"))).EnumerateArray().Select(d => d.GetProperty("title").GetString()!).OrderBy(t => t).ToList();

    [Fact]
    public async Task A_unit_document_is_uploaded_on_the_unit_and_shows_its_unit_link()
    {
        var s = await Scheme();
        var unit = await Unit(s, "42");
        var res = await s.Admin.PostAsync("/api/documents/library", On("unit", unit, "Lease, unit 42", "contract", "unit"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var doc = Assert.Single((await Ok(await s.Admin.GetAsync($"/api/documents/library?schemeIds={s.Kc}"))).EnumerateArray());
        Assert.Equal(("unit", "Unit 42, Kingfisher Court"), (doc.GetProperty("links")[0].GetProperty("kind").GetString(), doc.GetProperty("links")[0].GetProperty("label").GetString()));
    }

    [Fact]
    public async Task This_unit_only_is_for_a_unit_document()
    {
        var s = await Scheme();
        var res = await s.Admin.PostAsync("/api/documents/library", Form(s.Kc, visibility: "unit"));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.Contains("unit", (await res.FieldErrors()).GetProperty("visibility").GetString());
    }

    [Fact]
    public async Task Each_person_sees_only_what_is_shared_with_them()
    {
        var s = await Scheme();
        var unit42 = await Unit(s, "42");
        await Ok(await s.Admin.PostAsync("/api/documents/library", Form(s.Kc, title: "Owners’ guide", visibility: "owners")));
        await Ok(await s.Admin.PostAsync("/api/documents/library", Form(s.Kc, title: "Internal memo", visibility: "staff")));
        await Ok(await s.Admin.PostAsync("/api/documents/library", Form(s.Kc, title: "Trustee pack", visibility: "trustees")));
        await Ok(await s.Admin.PostAsync("/api/documents/library", On("unit", unit42, "Lease, unit 42", "contract", "unit")));

        var ownerOfUnit = await Resident(s, "ownerunit@acacia.example", "owner", unit42);
        var ownerOfScheme = await Resident(s, "owner@acacia.example", "owner");
        var trustee = await Resident(s, "trustee@acacia.example", "trustee");

        Assert.Equal(new[] { "Lease, unit 42", "Owners’ guide" }, await Titles(ownerOfUnit));
        Assert.Equal(new[] { "Owners’ guide" }, await Titles(ownerOfScheme));
        Assert.Equal(new[] { "Owners’ guide", "Trustee pack" }, await Titles(trustee));
    }

    [Fact]
    public async Task A_document_a_person_cannot_see_is_not_found_to_them()
    {
        var s = await Scheme();
        var memo = (await Ok(await s.Admin.PostAsync("/api/documents/library", Form(s.Kc, title: "Internal memo", visibility: "staff")))).GetProperty("id").GetString()!;
        var owner = await Resident(s, "owner@acacia.example", "owner");
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/documents/library/{memo}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/documents/library/{memo}/link")).StatusCode);
    }

    [Fact]
    public async Task A_job_document_is_uploaded_on_the_job_and_found_by_its_reference()
    {
        var s = await Scheme();
        var created = await s.Admin.PostAsJsonAsync("/api/jobs", new { schemeId = s.Kc.ToString(), location = "Roof", title = "Roof leak over unit 42", description = "Ceiling stain.", category = "Plumbing", priority = "high" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var reference = (await created.Json()).GetProperty("id").GetString()!;

        var form = new MultipartFormDataContent { { new StringContent("job"), "recordKind" }, { new StringContent(reference), "recordId" }, { new StringContent("Roof report"), "title" }, { new StringContent("correspondence"), "category" }, { new StringContent("staff"), "visibility" } };
        var file = new ByteArrayContent(Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        form.Add(file, "file", "roof.pdf");
        Assert.Equal(HttpStatusCode.OK, (await s.Admin.PostAsync("/api/documents/library", form)).StatusCode);

        var found = Assert.Single((await Ok(await s.Admin.GetAsync($"/api/documents/library?record=job:{reference}"))).EnumerateArray());
        Assert.Equal(("job", reference), (found.GetProperty("links")[0].GetProperty("kind").GetString(), found.GetProperty("links")[0].GetProperty("id").GetString()));
        Assert.Contains("Roof leak over unit 42", found.GetProperty("links")[0].GetProperty("label").GetString());
    }
}

