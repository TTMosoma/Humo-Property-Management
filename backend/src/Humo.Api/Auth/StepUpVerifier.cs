using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;

namespace Humo.Api.Auth;

/// <summary>Verifies a step-up proof for the signed-in person. Production: a passkey assertion (WebAuthn).</summary>
public interface IStepUpVerifier
{
    /// <summary>Null when it verifies; otherwise why not.</summary>
    Task<string?> VerifyAsync(HumoUser user, string credentialJson);
}

public sealed class PasskeyStepUpVerifier(SignInManager<HumoUser> signIn, UserManager<HumoUser> users) : IStepUpVerifier
{
    public async Task<string?> VerifyAsync(HumoUser user, string credentialJson)
    {
        var result = await signIn.PerformPasskeyAssertionAsync(credentialJson);
        if (!result.Succeeded) return result.Failure?.Message ?? "The passkey didn't verify";
        if (result.User.Id != user.Id) return "Another person's passkey";
        // Keep the passkey's signature counter and last use up to date.
        await users.AddOrUpdatePasskeyAsync(user, result.Passkey);
        return null;
    }
}
