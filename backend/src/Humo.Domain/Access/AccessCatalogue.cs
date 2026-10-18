using System.Collections.Frozen;
using System.Text.Json;

namespace Humo.Domain.Access;

/// <summary>A permission: what someone may do. Mutating permissions are refused in Observe impersonation.</summary>
public sealed record PermissionInfo(string Id, bool Mutates, bool StepUp);

/// <summary>
/// The fixed roles and their default permissions (D4), read from
/// <c>contracts/role-permissions.json</c>: the same table the frontend uses, so
/// the two can't drift (the frontend's contract test fails if they do).
/// Every check is by permission, never by role name.
/// </summary>
public static class AccessCatalogue
{
    public static FrozenDictionary<string, PermissionInfo> Permissions { get; }
    public static FrozenDictionary<string, FrozenSet<string>> Roles { get; }

    static AccessCatalogue()
    {
        using var stream = typeof(AccessCatalogue).Assembly.GetManifestResourceStream("Humo.Domain.role-permissions.json")
            ?? throw new InvalidOperationException("contracts/role-permissions.json isn't embedded in Humo.Domain.");
        var contract = JsonSerializer.Deserialize<Contract>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("contracts/role-permissions.json is empty.");

        Permissions = contract.Permissions.ToFrozenDictionary(p => p.Id);
        Roles = contract.Roles.ToFrozenDictionary(r => r.Key, r => r.Value.ToFrozenSet());

        var unknown = contract.Roles.SelectMany(r => r.Value).Where(p => !Permissions.ContainsKey(p)).Distinct().ToList();
        if (unknown.Count > 0) throw new InvalidOperationException($"Roles name unknown permissions: {string.Join(", ", unknown)}");
    }

    public static bool IsRole(string role) => Roles.ContainsKey(role);

    /// <summary>A role's default permissions plus the assignment's individual grants.</summary>
    public static IReadOnlyCollection<string> PermissionsOf(string role, IEnumerable<string>? grants = null)
    {
        var set = new HashSet<string>(Roles.TryGetValue(role, out var defaults) ? defaults : []);
        foreach (var grant in grants ?? []) if (Permissions.ContainsKey(grant)) set.Add(grant);
        return set;
    }

    private sealed record Contract(List<PermissionInfo> Permissions, Dictionary<string, List<string>> Roles);
}
