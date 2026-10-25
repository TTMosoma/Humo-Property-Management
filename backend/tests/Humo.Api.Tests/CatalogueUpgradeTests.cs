using System.Text.Json.Nodes;
using Humo.Api.Commercial;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>A catalogue already stored in the database follows Humo's starting catalogue at start-up.</summary>
public sealed class CatalogueUpgradeTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private Task<List<string>> AddOnIds() => api.Db(async db =>
    {
        var row = await db.PlatformSettings.SingleAsync(s => s.Key == CommercialRecords.CatalogueKey);
        return JsonNode.Parse(row.Value)!["addOns"]!.AsArray().Select(a => a!["id"]!.GetValue<string>()).ToList();
    });

    [Fact]
    public async Task The_custom_templates_add_on_is_withdrawn_because_Enterprise_includes_it()
    {
        Assert.DoesNotContain("custom-document-templates", await AddOnIds());

        // A database seeded before D23 still has it: start-up takes it out, as nobody bought it.
        await api.Db(async db =>
        {
            var row = await db.PlatformSettings.SingleAsync(s => s.Key == CommercialRecords.CatalogueKey);
            var cat = JsonNode.Parse(row.Value)!;
            var old = cat["addOns"]!.AsArray()[0]!.DeepClone();
            old["id"] = "custom-document-templates";
            cat["addOns"]!.AsArray().Add(old);
            row.Value = cat.ToJsonString();
            return await db.SaveChangesAsync();
        });
        Assert.Contains("custom-document-templates", await AddOnIds());
        await api.Db(async db =>
        {
            await CommercialRecords.SeedAsync(db);
            return 0;
        });
        Assert.DoesNotContain("custom-document-templates", await AddOnIds());
    }
}
