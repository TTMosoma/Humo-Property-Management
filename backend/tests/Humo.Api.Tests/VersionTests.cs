using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Xunit;

namespace Humo.Api.Tests;

/// <summary>One release number everywhere: contracts/version.json, the API, the frontend's package.json and CHANGELOG.md.</summary>
public sealed class VersionTests(HumoApiFactory api) : IClassFixture<HumoApiFactory>
{
    private static string Root()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "contracts", "version.json"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("The repository root (contracts/version.json) wasn't found.");
    }

    private static string VersionIn(string relativePath)
    {
        using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(Root(), relativePath)));
        return json.RootElement.GetProperty("version").GetString()!;
    }

    [Fact]
    public void The_release_number_is_the_same_everywhere()
    {
        var version = VersionIn(Path.Combine("contracts", "version.json"));
        Assert.Matches(@"^\d+\.\d+\.\d+$", version);
        Assert.Equal(version, Humo.Api.AppVersion.Current);
        Assert.Equal(version, VersionIn(Path.Combine("frontend", "humo-web", "package.json")));

        // The newest release in the changelog (the first heading after Unreleased).
        var changelog = File.ReadAllText(Path.Combine(Root(), "CHANGELOG.md"));
        Assert.Contains("## Unreleased", changelog);
        var newest = Regex.Match(changelog, @"^## (\d+\.\d+\.\d+) · ", RegexOptions.Multiline);
        Assert.True(newest.Success, "CHANGELOG.md has no release heading like '## 1.2.3 · 1 January 2027 · Title'.");
        Assert.Equal(version, newest.Groups[1].Value);
    }

    [Fact]
    public async Task Health_says_which_version_is_running()
    {
        var health = await api.Client().GetFromJsonAsync<JsonElement>("/api/health");
        Assert.Equal(Humo.Api.AppVersion.Current, health.GetProperty("version").GetString());
    }
}
