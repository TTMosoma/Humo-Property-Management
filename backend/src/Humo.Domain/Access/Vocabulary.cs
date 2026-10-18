namespace Humo.Domain.Access;

/// <summary>Role ids, exactly as the frontend and the contract file spell them.</summary>
public static class Roles
{
    public const string AgencyAdmin = "agency-admin";
    public const string PortfolioManager = "portfolio-manager";
    public const string Finance = "finance";
    public const string Operations = "operations";
    public const string Trustee = "trustee";
    public const string Owner = "owner";
    public const string Tenant = "tenant";

    public const string SystemAdmin = "system-admin";
    public const string AccountManager = "humo-account-manager";
    public const string Support = "humo-support";
    public const string Executive = "humo-executive";

    public static readonly IReadOnlySet<string> Humo = new HashSet<string> { SystemAdmin, AccountManager, Support, Executive };

    public static bool IsHumo(string role) => Humo.Contains(role);
}

/// <summary>Customer identities belong to organisations; Humo identities to Humo.</summary>
public static class IdentityKinds
{
    public const string Customer = "customer";
    public const string Humo = "humo";
}

/// <summary>Invited → Active → Suspended → Deactivated. Nothing is deleted.</summary>
public static class IdentityStatuses
{
    public const string Invited = "invited";
    public const string Active = "active";
    public const string Suspended = "suspended";
    public const string Deactivated = "deactivated";
}

/// <summary>Belonging to an organisation. Suspending it pauses every assignment there.</summary>
public static class MembershipStatuses
{
    public const string Active = "active";
    public const string Suspended = "suspended";
    public const string Ended = "ended";
}

public static class AssignmentStatuses
{
    public const string Active = "active";
    public const string Ended = "ended";
}

/// <summary>Where an assignment applies; always explicit, never "an empty list means everything".</summary>
public static class ScopeTypes
{
    public const string Platform = "platform";
    public const string Organisation = "organisation";
    public const string Schemes = "schemes";
    public const string Unit = "unit";
}

public static class OrganisationStatuses
{
    public const string Onboarding = "onboarding";
    public const string Active = "active";
    public const string Suspended = "suspended";
    public const string Archived = "archived";

    /// <summary>People can work only in an onboarding or active organisation (doc 24 S3).</summary>
    public static bool IsOpen(string status) => status is Onboarding or Active;
}

/// <summary>Humo staff sign in with a Humo address; customers never can (doc 16).</summary>
public static class HumoEmail
{
    public const string Domain = "humo.co.za";

    public static bool IsHumoAddress(string email) => email.Trim().EndsWith("@" + Domain, StringComparison.OrdinalIgnoreCase);
}
