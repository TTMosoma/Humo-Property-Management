using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Api.Tests;

/// <summary>Seeds organisations and people straight into the test database, and signs them in by email link.</summary>
public static partial class TestPeople
{
    public static async Task<Guid> Organisation(this HumoApiFactory api, string shortName, string status = OrganisationStatuses.Active) =>
        await api.Db(async db =>
        {
            var org = new Organisation { Id = Guid.CreateVersion7(), Name = shortName + " (Pty) Ltd", ShortName = shortName, City = "Johannesburg", Province = "Gauteng", Status = status };
            db.Organisations.Add(org);
            await db.SaveChangesAsync();
            return org.Id;
        });

    /// <summary>A customer as an approved account request leaves it: onboarding, with a trial of the package (docs/21, docs/23).</summary>
    public static async Task<Guid> Customer(this HumoApiFactory api, string shortName, string packageId = "professional", Guid? accountManagerId = null)
    {
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HumoDbContext>();
        var org = new Organisation
        {
            Id = Guid.CreateVersion7(), Name = shortName + " (Pty) Ltd", ShortName = shortName, City = "Durban", Province = "KwaZulu-Natal",
            Status = OrganisationStatuses.Active, AccountManagerId = accountManagerId, TrialPackageId = packageId, CreatedAt = api.Clock.GetUtcNow(),
        };
        db.Organisations.Add(org);
        await scope.ServiceProvider.GetRequiredService<Humo.Api.Commercial.CommercialRecords>().OpenAsync(org, packageId, null, CancellationToken.None);
        await db.SaveChangesAsync();
        return org.Id;
    }

    /// <summary>A customer with one role in the organisation: organisation-wide, or limited to some schemes.</summary>
    public static async Task<Guid> Person(this HumoApiFactory api, string email, string role, Guid? organisationId, IEnumerable<Guid>? schemes = null, params string[] grants)
    {
        using var scope = api.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<HumoUser>>();
        var db = scope.ServiceProvider.GetRequiredService<HumoDbContext>();
        var user = new HumoUser
        {
            Id = Guid.CreateVersion7(), UserName = email, Email = email, Name = email.Split('@')[0].Replace('.', ' '),
            Kind = Roles.IsHumo(role) ? IdentityKinds.Humo : IdentityKinds.Customer, Status = IdentityStatuses.Active,
        };
        Assert.True((await users.CreateAsync(user)).Succeeded);
        if (organisationId is { } org) db.Memberships.Add(new Membership { Id = Guid.CreateVersion7(), UserId = user.Id, OrganisationId = org, Since = DateTimeOffset.UtcNow });
        var schemeIds = schemes?.Select(s => s.ToString()).ToList() ?? [];
        db.RoleAssignments.Add(new RoleAssignment
        {
            Id = Guid.CreateVersion7(), UserId = user.Id, Role = role, OrganisationId = organisationId,
            ScopeType = organisationId is null ? ScopeTypes.Platform : schemeIds.Count > 0 ? ScopeTypes.Schemes : ScopeTypes.Organisation,
            SchemeIds = schemeIds, Grants = [.. grants], Label = role, GrantedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return user.Id;
    }

    /// <summary>A fresh client signed in as this person (email link).</summary>
    public static async Task<HttpClient> SignedIn(this HumoApiFactory api, string email)
    {
        var client = api.Client();
        api.Email.Sent.Clear();
        var sent = await client.PostAsJsonAsync("/api/auth/link", new { email });
        Assert.Equal(HttpStatusCode.Accepted, sent.StatusCode);
        var code = (await sent.Json()).GetProperty("code").GetString()!;
        var token = Token().Match(Assert.Single(api.Email.Sent).Text).Groups[1].Value;
        api.Email.Sent.Clear();
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/auth/link/complete", new { token, code })).StatusCode);
        return client;
    }

    /// <summary>A fresh step-up proof for this client's session (the test verifier stands in for the passkey).</summary>
    public static async Task StepUp(this HttpClient client) =>
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/me/step-up", new { credential = "test-passkey" })).StatusCode);

    public static async Task<JsonElement> Json(this HttpResponseMessage res) => await res.Content.ReadFromJsonAsync<JsonElement>();

    public static async Task<string> ProblemCode(this HttpResponseMessage res) => (await res.Json()).GetProperty("code").GetString()!;

    public static async Task<JsonElement> FieldErrors(this HttpResponseMessage res) => (await res.Json()).GetProperty("errors");

    [GeneratedRegex(@"token=([A-Za-z0-9_\-]+)")]
    private static partial Regex Token();
}
