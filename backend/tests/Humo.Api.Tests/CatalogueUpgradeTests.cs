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

    [Fact]
    public async Task The_Governance_add_on_becomes_Meetings_and_AGMs_unless_Humo_renamed_it_since()
    {
        JsonNode Governance(JsonNode cat) => cat["addOns"]!.AsArray().Single(a => a!["id"]!.GetValue<string>() == "governance")!;
        Task<JsonNode> Stored() => api.Db(async db => Governance(JsonNode.Parse((await db.PlatformSettings.SingleAsync(s => s.Key == CommercialRecords.CatalogueKey)).Value)!));
        Task Store(string name) => api.Db(async db =>
        {
            var row = await db.PlatformSettings.SingleAsync(s => s.Key == CommercialRecords.CatalogueKey);
            var cat = JsonNode.Parse(row.Value)!;
            Governance(cat)["name"] = name;
            Governance(cat)["features"] = new JsonArray("governance", "trustee-management", "meetings", "agm-sgm");
            row.Value = cat.ToJsonString();
            return await db.SaveChangesAsync();
        });
        Task Start() => api.Db(async db => { await CommercialRecords.SeedAsync(db); return 0; });

        // Stored before D29: renamed, and the trustee register (now on every plan) leaves its features.
        await Store("Governance");
        await Start();
        var renamed = await Stored();
        Assert.Equal("Meetings & AGMs", renamed["name"]!.GetValue<string>());
        Assert.Equal(["governance", "meetings", "agm-sgm"], renamed["features"]!.AsArray().Select(f => f!.GetValue<string>()).ToList());

        // A name Humo chose since stands.
        await Store("Board tools");
        await Start();
        Assert.Equal("Board tools", (await Stored())["name"]!.GetValue<string>());
    }
}
