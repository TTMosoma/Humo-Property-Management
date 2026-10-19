using Humo.Api.Audit;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Startup;

public static class DatabaseInitialiser
{
    /// <summary>
    /// Brings the database up to date, then makes sure there's a way in: on an
    /// empty platform, the configured first System Administrator is invited.
    /// No demo data is ever created here (docs/18 R-6).
    /// </summary>
    public static async Task InitialiseDatabaseAsync(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<HumoDbContext>();
        var log = sp.GetRequiredService<ILoggerFactory>().CreateLogger("Humo.Startup");

        switch (sp.GetRequiredService<IOptions<DatabaseOptions>>().Value.Initialise)
        {
            case "Migrate": await db.Database.MigrateAsync(); break;
            case "EnsureCreated": await db.Database.EnsureCreatedAsync(); break;
        }

        var bootstrap = sp.GetRequiredService<IOptions<BootstrapOptions>>().Value;
        if (string.IsNullOrWhiteSpace(bootstrap.AdminEmail)) return;

        var hasAdmin = await db.RoleAssignments.AnyAsync(a => a.Role == Roles.SystemAdmin && a.Status == AssignmentStatuses.Active);
        if (hasAdmin) return;

        var email = bootstrap.AdminEmail.Trim().ToLowerInvariant();
        if (!HumoEmail.IsHumoAddress(email))
            throw new InvalidOperationException($"Bootstrap:AdminEmail must be a @{HumoEmail.Domain} address: Humo staff sign in with Humo addresses only.");

        var users = sp.GetRequiredService<UserManager<HumoUser>>();
        var clock = sp.GetRequiredService<TimeProvider>();
        var now = clock.GetUtcNow();
        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            user = new HumoUser
            {
                Id = Guid.CreateVersion7(),
                UserName = email,
                Email = email,
                EmailConfirmed = false,
                Name = bootstrap.AdminName.Trim(),
                Kind = IdentityKinds.Humo,
                Status = IdentityStatuses.Invited,
                CreatedAt = now,
            };
            var created = await users.CreateAsync(user);
            if (!created.Succeeded) throw new InvalidOperationException("Couldn't create the first System Administrator: " + string.Join("; ", created.Errors.Select(e => e.Description)));
        }

        db.RoleAssignments.Add(new RoleAssignment
        {
            Id = Guid.CreateVersion7(),
            UserId = user.Id,
            Role = Roles.SystemAdmin,
            ScopeType = ScopeTypes.Platform,
            Label = "Platform",
            GrantedBy = "Bootstrap (first System Administrator)",
            GrantedAt = now,
        });
        sp.GetRequiredService<AuditLog>().Record($"Invited the first System Administrator ({email})", "success", reason: "Empty platform: Bootstrap:AdminEmail", role: Roles.SystemAdmin, resource: "Identity", resourceId: user.Id.ToString());
        await db.SaveChangesAsync();
        log.LogWarning("First System Administrator invited: {Name}. Sign in at {Url}/sign-in with an email link, then add a passkey.", user.Name, sp.GetRequiredService<IOptions<AppOptions>>().Value.PublicUrl);
    }
}
