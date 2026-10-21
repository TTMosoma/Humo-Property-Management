namespace Humo.Api.Auth;

/// <summary>
/// How long a session may sit idle and how long it may last (docs/17; the session policy agreed on 21 Oct 2026).
/// Passkeys prove a device holds the key, so they get the longest limits. An email link proves control of an
/// inbox, so its sessions get the shortest. The limits follow NIST SP 800-63B's reauthentication guidance
/// (30 minutes of inactivity, 12 hours overall) for the strongest case, and shorten from there.
/// </summary>
public static class SessionPolicy
{
    /// <summary>The cookie claim naming the server-side session (docs/17 D14: sessions are revocable).</summary>
    public const string SessionClaim = "humo:session";
    public const string PasskeyMethod = "passkey";
    public const string LinkMethod = "link";

    /// <summary>A browser marked as the person's own is trusted for this long.</summary>
    public static readonly TimeSpan TrustLifetime = TimeSpan.FromDays(30);

    /// <summary>Activity is recorded at most this often, so ordinary requests don't write to the database each time.</summary>
    public static readonly TimeSpan ActivityInterval = TimeSpan.FromMinutes(1);

    /// <summary>Roles with power over a whole agency or the platform: their sessions never idle longer than 15 minutes.</summary>
    private static readonly string[] AdminRoles = ["system-admin", "agency-admin"];

    /// <summary>
    /// Passkey, own computer: 30 min idle, 12 h. Passkey, not marked as own: 15 min idle, 8 h.
    /// Email link (never trusted): 15 min idle, 4 h. An admin role caps idle at 15 min whatever the sign-in.
    /// </summary>
    public static (int IdleMinutes, TimeSpan Absolute) For(string method, bool trusted, string? role)
    {
        var (idle, absolute) = method == PasskeyMethod && trusted ? (30, TimeSpan.FromHours(12))
            : method == PasskeyMethod ? (15, TimeSpan.FromHours(8))
            : (15, TimeSpan.FromHours(4));
        if (role is not null && AdminRoles.Contains(role)) idle = Math.Min(idle, 15);
        return (idle, absolute);
    }
}
