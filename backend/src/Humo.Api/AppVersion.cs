using System.Text.Json;

namespace Humo.Api;

/// <summary>The release number, from contracts/version.json (shared with the frontend; see CHANGELOG.md).</summary>
public static class AppVersion
{
    public static string Current { get; } = Read();

    private static string Read()
    {
        using var stream = typeof(AppVersion).Assembly.GetManifestResourceStream("Humo.Api.version.json")
            ?? throw new InvalidOperationException("contracts/version.json isn't embedded in the API.");
        using var json = JsonDocument.Parse(stream);
        return json.RootElement.GetProperty("version").GetString() ?? throw new InvalidOperationException("contracts/version.json has no version.");
    }
}
