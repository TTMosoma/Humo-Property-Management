namespace Humo.Api;

/// <summary>Where the app lives and how passkeys are bound to it (doc 25, D14).</summary>
public sealed class AppOptions
{
    public const string Section = "App";

    /// <summary>The address people use, e.g. https://pm.humo.co.za. Sign-in links point here.</summary>
    public string PublicUrl { get; set; } = "https://pm.humo.co.za";
    /// <summary>The passkey relying-party ID. <c>pm.humo.co.za</c> in production. NEVER change it: every passkey is bound to it.</summary>
    public string PasskeyDomain { get; set; } = "pm.humo.co.za";
    /// <summary>Origins a passkey ceremony may come from (the app's own address; in development also the dev server).</summary>
    public List<string> AllowedOrigins { get; set; } = ["https://pm.humo.co.za"];
    /// <summary>How long an emailed sign-in link works.</summary>
    public TimeSpan SignInLinkLifetime { get; set; } = TimeSpan.FromMinutes(15);
}

/// <summary>The first System Administrator, created once on an empty database (doc 26 §7).</summary>
public sealed class BootstrapOptions
{
    public const string Section = "Bootstrap";

    /// <summary>A @humo.co.za address. They sign in with an emailed link, then add a passkey.</summary>
    public string? AdminEmail { get; set; }
    public string AdminName { get; set; } = "System Administrator";
}

/// <summary>How the database is prepared at start-up.</summary>
public sealed class DatabaseOptions
{
    public const string Section = "Database";

    /// <summary><c>Migrate</c> (default: apply EF Core migrations), <c>EnsureCreated</c> (tests) or <c>None</c>.</summary>
    public string Initialise { get; set; } = "Migrate";
}
