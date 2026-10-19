namespace Humo.Api.Auth;

public static class RateLimits
{
    /// <summary>Sign-in requests per IP address: 10 a minute (docs/18 R-8: rate-limit links).</summary>
    public const string SignIn = "sign-in";
}
