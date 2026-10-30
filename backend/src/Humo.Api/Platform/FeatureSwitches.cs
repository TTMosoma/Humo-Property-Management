namespace Humo.Api.Platform;

/// <summary>
/// Feature switches (technical rollout, separate from plan entitlements): which built screens are switched on. The
/// app shows a screen only when its switch and the agency's plan both allow it. Everything on the API is on by default;
/// a switch can be turned off in configuration (FeatureSwitches:receipt-capture = false), e.g. while a fault is fixed.
/// Platform › Feature flags, for per-agency rollout, comes with the platform operations slice.
/// </summary>
public static class FeatureSwitches
{
    /// <summary>The switches the app reads, all for screens built on the API.</summary>
    public static readonly string[] Defaults = ["receipt-capture", "meter-readings", "levy-model"];

    public static void MapFeatureSwitches(this IEndpointRouteBuilder api) =>
        api.MapGet("/me/flags", (IConfiguration config) =>
            Results.Ok(Defaults.ToDictionary(key => key, key => config.GetValue($"FeatureSwitches:{key}", true)))).RequireAuthorization();
}
