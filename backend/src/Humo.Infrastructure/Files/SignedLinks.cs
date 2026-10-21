using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace Humo.Infrastructure.Files;

/// <summary>
/// Download links are signed with HMAC-SHA256 over the file, the person it was issued to, and when it ends. A link
/// opens only for that person, only until then, and only while they can still see the file.
/// </summary>
public static class SignedLinks
{
    public static string Payload(Guid fileId, Guid userId, DateTimeOffset expires) =>
        $"{fileId:N}.{userId:N}.{expires.ToUnixTimeSeconds()}";

    public static string Sign(string base64Key, string payload)
    {
        using var hmac = new HMACSHA256(Convert.FromBase64String(base64Key));
        return WebEncoders.Base64UrlEncode(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload)));
    }

    public static bool Verify(string base64Key, string payload, string signature)
    {
        var expected = Encoding.UTF8.GetBytes(Sign(base64Key, payload));
        var given = Encoding.UTF8.GetBytes(signature);
        return expected.Length == given.Length && CryptographicOperations.FixedTimeEquals(expected, given);
    }
}
