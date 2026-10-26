using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;

namespace Humo.Api.Tests;

/// <summary>Platform › Document templates on the API (D12, D23): custom templates for Enterprise, and Humo's own templates' statuses.</summary>
public sealed class DocumentTemplateTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private static object Design(string title = "Statement of account") => new
    {
        layout = "levy-statement/branded", brandingMode = "template", palette = new { primary = "#0a3d62", accent = "#1d7a52" }, font = "outfit",
        sections = new[] { "summary", "transactions", "payment", "queries" }, title,
    };

    private static object Publish(object design, string? approvedBy = "Thandeka Nkosi, Director", string approvedOn = "2026-10-18", int expectedVersion = 1) =>
        new { design, notes = "The client's colours and title", clientApproval = new { approvedBy, approvedOn }, expectedVersion };

    [Fact]
    public async Task Humo_sets_up_an_Enterprise_customers_template_publishes_proofed_versions_and_the_agency_chooses_it()
    {
        var acacia = await api.Customer("Acacia", "enterprise");
        var marula = await api.Customer("Marula", "professional");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, acacia);
        var humo = await api.SignedIn(HumoApiFactory.AdminEmail);

        // D23: Enterprise only.
        var refused = await humo.PostAsJsonAsync($"/api/platform/customers/{marula}/document-templates", new { documentType = "levy-statement" });
        Assert.Contains("Humo Enterprise", (await refused.FieldErrors()).GetProperty("organisationId").GetString());

        var created = await humo.PostAsJsonAsync($"/api/platform/customers/{acacia}/document-templates", new { documentType = "levy-statement" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.Json()).GetProperty("id").GetString();
        Assert.True((await (await humo.PostAsJsonAsync($"/api/platform/customers/{acacia}/document-templates", new { documentType = "levy-statement" })).FieldErrors()).TryGetProperty("organisationId", out _));

        // A version needs the client's proof approval, and a valid design.
        var noProof = await humo.PostAsJsonAsync($"/api/platform/document-templates/{id}/versions", Publish(Design(), approvedBy: ""));
        Assert.True((await noProof.FieldErrors()).TryGetProperty("approvedBy", out _));
        var badDesign = await humo.PostAsJsonAsync($"/api/platform/document-templates/{id}/versions",
            Publish(new { layout = "levy-statement/branded", brandingMode = "template", palette = new { primary = "navy", accent = "#1d7a52" }, sections = new[] { "summary" } }));
        var errors = await badDesign.FieldErrors();
        Assert.True(errors.TryGetProperty("primary", out _) && errors.TryGetProperty("transactions", out _));
        var published = await humo.PostAsJsonAsync($"/api/platform/document-templates/{id}/versions", Publish(Design()));
        Assert.Equal(HttpStatusCode.OK, published.StatusCode);
        Assert.Equal(2, (await published.Json()).GetProperty("version").GetInt32());

        // The agency sees it with Humo's, and can make it its default.
        var admin = await api.SignedIn("thandeka@acacia.example");
        var mine = (await (await admin.GetAsync("/api/documents/templates")).Json()).EnumerateArray().Single(t => t.GetProperty("id").GetString() == id);
        Assert.Equal(("custom", 2), (mine.GetProperty("tier").GetString(), mine.GetProperty("currentVersion").GetInt32()));
        Assert.Equal(["retired", "published"], mine.GetProperty("versions").EnumerateArray().Select(v => v.GetProperty("status").GetString()));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync("/api/documents/settings/defaults/levy-statement", new { templateId = id, expectedVersion = 0 })).StatusCode);

        // Another agency never sees it.
        await api.Person("pieter@marula.example", Roles.AgencyAdmin, marula);
        var other = await api.SignedIn("pieter@marula.example");
        Assert.DoesNotContain((await (await other.GetAsync("/api/documents/templates")).Json()).EnumerateArray(), t => t.GetProperty("id").GetString() == id);

        // Humo's adoption view counts it.
        var adoption = await (await humo.GetAsync("/api/platform/document-templates")).Json();
        Assert.Equal(1, adoption.GetProperty("customTemplates").GetInt32());
        var usage = adoption.GetProperty("usage").EnumerateArray().Single(u => u.GetProperty("template").GetProperty("id").GetString() == id);
        Assert.Equal(("Acacia", 1), (usage.GetProperty("owner").GetString(), usage.GetProperty("defaultFor").GetInt32()));
    }

    [Fact]
    public async Task Humo_moves_its_own_templates_through_their_statuses()
    {
        var humo = await api.SignedIn(HumoApiFactory.AdminEmail);
        async Task<JsonElement> Template(string templateId) =>
            (await (await humo.GetAsync("/api/platform/document-templates")).Json()).GetProperty("usage").EnumerateArray()
                .Single(u => u.GetProperty("template").GetProperty("id").GetString() == templateId).GetProperty("template");

        // A planned template with no layout yet can't be previewed.
        var planned = await humo.PutAsJsonAsync("/api/platform/document-templates/levy-statement.executive/status", new { status = "preview", reason = "Ready to try", expectedVersion = 1 });
        Assert.True((await planned.FieldErrors()).TryGetProperty("status", out _));
        // The default for its type can't be deprecated.
        var asDefault = await humo.PutAsJsonAsync("/api/platform/document-templates/levy-statement.standard/status", new { status = "deprecated", reason = "Replacing it", expectedVersion = 1 });
        Assert.Contains("default", (await asDefault.FieldErrors()).GetProperty("status").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await humo.PutAsJsonAsync("/api/platform/document-templates/meeting-notice.professional/status",
            new { status = "deprecated", reason = "Replaced by a new layout", expectedVersion = 1 })).StatusCode);
        var t = await Template("meeting-notice.professional");
        Assert.Equal(("deprecated", 2), (t.GetProperty("status").GetString(), t.GetProperty("version").GetInt32()));
    }
}
