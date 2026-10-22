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
}
