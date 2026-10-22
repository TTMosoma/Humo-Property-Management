using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Humo.Infrastructure.Files;

namespace Humo.Api.Tests;

/// <summary>
/// Uploaded files (docs/18 R-11): only checked PDFs are stored, under a random key, and reach people through links that
/// are signed for them, last minutes, and are checked against the scheme when served.
/// </summary>
public sealed class FileTests : IDisposable
{
    /// <summary>A 256-bit key, base64, as the configuration holds it.</summary>
    public const string SigningKey = "ZmlsZS1saW5rLXNpZ25pbmcta2V5LWZvci10ZXN0cy0zMmI=";

    private const int MaxBytes = 4096;
    private readonly HumoApiFactory api = new HumoApiFactory().With("Files:MaxBytes", MaxBytes.ToString());

    public void Dispose() => api.Dispose();

    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

    private sealed record Setup(HttpClient Admin, Guid Kc, Guid Riverside, Guid Org);

    /// <summary>Acacia, with Kingfisher Court and Riverside Estate, and an agency administrator.</summary>
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

    private static MultipartFormDataContent Form(Guid schemeId, string fileName, byte[] content, string contentType = "application/pdf")
    {
        var form = new MultipartFormDataContent { { new StringContent(schemeId.ToString()), "schemeId" } };
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(file, "file", fileName);
        return form;
    }

    private static async Task<HttpResponseMessage> Upload(HttpClient client, Guid schemeId, string fileName, byte[] content, string contentType = "application/pdf") =>
        await client.PostAsync("/api/files", Form(schemeId, fileName, content, contentType));

    private async Task<int> StoredFiles() => await api.Db(db => db.UploadedFiles.CountAsync());

    [Fact]
    public async Task A_checked_pdf_is_stored_under_a_random_key_and_opens_through_a_link()
    {
        var s = await Scheme();
        var res = await Upload(s.Admin, s.Kc, "levy notice.pdf", Pdf);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var id = (await res.Json()).GetProperty("id").GetString()!;

        var stored = await api.Db(db => db.UploadedFiles.SingleAsync());
        Assert.Equal(("clean", "levy notice.pdf"), (stored.ScanResult, stored.Name));
        Assert.Matches("^[0-9a-f]{32}$", stored.StorageKey);
        var root = Path.GetFullPath(api.Services.GetRequiredService<IOptions<FilesOptions>>().Value.Root);
        Assert.True(File.Exists(Path.Combine(root, stored.StorageKey[..2], stored.StorageKey)));

        var link = await Ok(await s.Admin.GetAsync($"/api/files/{id}/link"));
        var content = await s.Admin.GetAsync(link.GetProperty("url").GetString());
        Assert.Equal(HttpStatusCode.OK, content.StatusCode);
        Assert.Equal("application/pdf", content.Content.Headers.ContentType!.MediaType);
        Assert.Equal(Pdf, await content.Content.ReadAsByteArrayAsync());
        Assert.Equal("inline", content.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal("nosniff", content.Headers.GetValues("X-Content-Type-Options").Single());
    }

    [Fact]
    public async Task Only_a_PDF_is_accepted_whatever_the_name_says()
    {
        var s = await Scheme();
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Upload(s.Admin, s.Kc, "notes.pdf", Encoding.ASCII.GetBytes("just text"))).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Upload(s.Admin, s.Kc, "photo.jpg", Pdf)).StatusCode);
        Assert.Equal(0, await StoredFiles());
    }

    [Fact]
    public async Task A_file_over_the_size_limit_is_refused()
    {
        var s = await Scheme();
        var big = Pdf.Concat(new byte[MaxBytes]).ToArray();
        var res = await Upload(s.Admin, s.Kc, "big.pdf", big);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.Contains("larger", (await res.FieldErrors()).GetProperty("file").GetString());
        Assert.Equal(0, await StoredFiles());
    }

    [Fact]
    public async Task An_infected_file_is_refused_and_not_stored()
    {
        var s = await Scheme();
        var infected = Pdf.Concat(Encoding.ASCII.GetBytes("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")).ToArray();
        var res = await Upload(s.Admin, s.Kc, "invoice.pdf", infected);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.Equal("infected", (await res.Json()).GetProperty("code").GetString());
        Assert.Equal(0, await StoredFiles());
    }

    [Fact]
    public async Task Nothing_is_stored_when_the_scanner_cannot_answer()
    {
        var s = await Scheme();
        api.Scanner.Unavailable = true;
        var res = await Upload(s.Admin, s.Kc, "notice.pdf", Pdf);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
        Assert.Equal(0, await StoredFiles());
    }

    [Fact]
    public async Task A_link_is_for_one_person_and_stops_after_its_time()
    {
        var s = await Scheme();
        var id = (await (await Upload(s.Admin, s.Kc, "notice.pdf", Pdf)).Json()).GetProperty("id").GetString()!;
        var link = (await Ok(await s.Admin.GetAsync($"/api/files/{id}/link"))).GetProperty("url").GetString()!;

        // Someone else who has the link can't use it.
        await api.Person("priya@acacia.example", Roles.AgencyAdmin, s.Org);
        var other = await api.SignedIn("priya@acacia.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(link)).StatusCode);

        // After five minutes it no longer opens, even for its owner.
        api.Clock.Advance(TimeSpan.FromMinutes(6));
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Admin.GetAsync(link)).StatusCode);
    }

    [Fact]
    public async Task A_person_outside_the_scheme_gets_no_link()
    {
        var s = await Scheme();
        var id = (await (await Upload(s.Admin, s.Kc, "notice.pdf", Pdf)).Json()).GetProperty("id").GetString()!;
        await api.Person("sizwe@acacia.example", Roles.Trustee, s.Org, [s.Riverside]);
        var outsider = await api.SignedIn("sizwe@acacia.example");
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/files/{id}/link")).StatusCode);
    }

    [Fact]
    public async Task A_link_cannot_be_changed_to_reach_another_file()
    {
        var s = await Scheme();
        var id = (await (await Upload(s.Admin, s.Kc, "notice.pdf", Pdf)).Json()).GetProperty("id").GetString()!;
        var link = (await Ok(await s.Admin.GetAsync($"/api/files/{id}/link"))).GetProperty("url").GetString()!;
        var other = Guid.CreateVersion7();
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Admin.GetAsync(link.Replace(id.Replace("-", ""), other.ToString("N")))).StatusCode);
    }

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Json();
    }
}
