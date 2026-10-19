using System.Text.Json;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Humo.Infrastructure.Data;

/// <summary>
/// Humo's database: identities and passkeys (ASP.NET Core Identity, schema v3),
/// organisations, memberships, role assignments, the audit log, sign-in links,
/// and the Data Protection keys (so sign-in cookies survive restarts; doc 26 §3).
/// </summary>
public sealed class HumoDbContext(DbContextOptions<HumoDbContext> options)
    : IdentityDbContext<HumoUser, IdentityRole<Guid>, Guid, IdentityUserClaim<Guid>, IdentityUserRole<Guid>, IdentityUserLogin<Guid>,
        IdentityRoleClaim<Guid>, IdentityUserToken<Guid>, IdentityUserPasskey<Guid>>(options), IDataProtectionKeyContext
{
    public DbSet<Organisation> Organisations => Set<Organisation>();
    public DbSet<Scheme> Schemes => Set<Scheme>();
    public DbSet<AccountRequest> AccountRequests => Set<AccountRequest>();
    public DbSet<PlatformSetting> PlatformSettings => Set<PlatformSetting>();
    public DbSet<Notice> Notices => Set<Notice>();
    public DbSet<NoticeRead> NoticeReads => Set<NoticeRead>();
    public DbSet<PendingHumoGrant> PendingHumoGrants => Set<PendingHumoGrant>();
    public DbSet<Unit> Units => Set<Unit>();
    public DbSet<LevyAccount> LevyAccounts => Set<LevyAccount>();
    public DbSet<Person> People => Set<Person>();
    public DbSet<Relationship> Relationships => Set<Relationship>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<RoleAssignment> RoleAssignments => Set<RoleAssignment>();
    public DbSet<AuditEntry> Audit => Set<AuditEntry>();
    public DbSet<SignInLink> SignInLinks => Set<SignInLink>();
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<HumoUser>(e =>
        {
            e.Property(u => u.Name).HasMaxLength(200);
            e.Property(u => u.Kind).HasMaxLength(20);
            e.Property(u => u.Status).HasMaxLength(20);
            e.Property(u => u.SuspendedFrom).HasMaxLength(20);
            e.Property(u => u.Title).HasMaxLength(200);
            e.Property(u => u.PersonId).HasMaxLength(64);
            e.Property(u => u.Version).IsConcurrencyToken();
            e.HasIndex(u => u.NormalizedEmail).IsUnique();
            e.HasMany(u => u.Memberships).WithOne().HasForeignKey(m => m.UserId);
            e.HasMany(u => u.Assignments).WithOne().HasForeignKey(a => a.UserId);
        });

        builder.Entity<Organisation>(e =>
        {
            e.ToTable("Organisations");
            e.Property(o => o.Name).HasMaxLength(200);
            e.Property(o => o.ShortName).HasMaxLength(100);
            e.HasIndex(o => o.ShortName).IsUnique();
            e.Property(o => o.Version).IsConcurrencyToken();
        });

        builder.Entity<AccountRequest>(e =>
        {
            e.ToTable("AccountRequests");
            e.Property(x => x.Ref).HasMaxLength(20);
            e.HasIndex(x => x.Ref).IsUnique();
            e.Property(x => x.Version).IsConcurrencyToken();
            e.Property(x => x.Status).HasMaxLength(20);
        });

        builder.Entity<PlatformSetting>(e =>
        {
            e.ToTable("PlatformSettings");
            e.HasKey(x => x.Key);
            e.Property(x => x.Version).IsConcurrencyToken();
        });

        builder.Entity<Notice>(e =>
        {
            e.ToTable("Notices");
            e.HasIndex(x => x.ToIdentityId);
            e.HasIndex(x => x.ToRole);
        });

        builder.Entity<PendingHumoGrant>(e =>
        {
            e.ToTable("PendingHumoGrants");
            e.HasIndex(x => x.IdentityId);
        });

        builder.Entity<NoticeRead>(e =>
        {
            e.ToTable("NoticeReads");
            e.HasKey(x => new { x.NoticeId, x.IdentityId });
        });

        builder.Entity<Scheme>(e =>
        {
            e.ToTable("Schemes");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Code).HasMaxLength(4);
            e.Property(x => x.Type).HasMaxLength(40);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => new { x.OrganisationId, x.Code }).IsUnique();
            e.HasOne<Organisation>().WithMany().HasForeignKey(x => x.OrganisationId);
        });

        builder.Entity<Unit>(e =>
        {
            e.ToTable("Units");
            e.Property(x => x.Number).HasMaxLength(6);
            e.Property(x => x.AccountNo).HasMaxLength(12);
            e.Property(x => x.Description).HasMaxLength(200);
            e.Property(x => x.Occupancy).HasMaxLength(20);
            e.Property(x => x.SizeM2).HasPrecision(10, 2);
            e.Property(x => x.ParticipationQuota).HasPrecision(9, 6);
            e.Property(x => x.MonthlyLevy).HasPrecision(18, 2);
            e.Property(x => x.ParkingBays).HasConversion(StringList.Converter, StringList.Comparer);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => new { x.SchemeId, x.Number }).IsUnique();
            e.HasOne<Scheme>().WithMany().HasForeignKey(x => x.SchemeId);
        });

        builder.Entity<LevyAccount>(e =>
        {
            e.ToTable("LevyAccounts");
            e.Property(x => x.AccountNo).HasMaxLength(12);
            e.Property(x => x.Balance).HasPrecision(18, 2);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.StatementBy).HasMaxLength(10);
            e.HasIndex(x => x.UnitId).IsUnique();
            e.HasOne<Unit>().WithMany().HasForeignKey(x => x.UnitId);
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.HolderPersonId);
        });

        builder.Entity<Person>(e =>
        {
            e.ToTable("People");
            e.Property(x => x.FirstName).HasMaxLength(100);
            e.Property(x => x.LastName).HasMaxLength(200);
            e.Property(x => x.DisplayName).HasMaxLength(250);
            e.Property(x => x.Email).HasMaxLength(320);
            e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => x.OrganisationId);
            e.HasOne<Organisation>().WithMany().HasForeignKey(x => x.OrganisationId);
        });

        builder.Entity<Relationship>(e =>
        {
            e.ToTable("Relationships");
            e.Property(x => x.Type).HasMaxLength(20);
            e.HasIndex(x => x.PersonId);
            e.HasIndex(x => new { x.SchemeId, x.Type });
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.PersonId);
            e.HasOne<Scheme>().WithMany().HasForeignKey(x => x.SchemeId);
            e.HasOne<Unit>().WithMany().HasForeignKey(x => x.UnitId);
        });

        builder.Entity<Membership>(e =>
        {
            e.ToTable("Memberships");
            e.HasIndex(m => new { m.UserId, m.OrganisationId });
            e.HasOne<Organisation>().WithMany().HasForeignKey(m => m.OrganisationId);
        });

        builder.Entity<RoleAssignment>(e =>
        {
            e.ToTable("RoleAssignments");
            e.Property(a => a.Role).HasMaxLength(40);
            e.Property(a => a.ScopeType).HasMaxLength(20);
            e.Property(a => a.Label).HasMaxLength(200);
            e.Property(a => a.Version).IsConcurrencyToken();
            e.Property(a => a.SchemeIds).HasConversion(StringList.Converter, StringList.Comparer);
            e.Property(a => a.Grants).HasConversion(StringList.Converter, StringList.Comparer);
            e.HasOne<Organisation>().WithMany().HasForeignKey(a => a.OrganisationId);
        });

        builder.Entity<AuditEntry>(e =>
        {
            e.ToTable("AuditLog");
            e.Property(a => a.Action).HasMaxLength(500);
            e.HasIndex(a => a.At);
            e.HasIndex(a => a.OrganisationId);
        });

        builder.Entity<SignInLink>(e =>
        {
            e.ToTable("SignInLinks");
            e.HasIndex(l => l.TokenHash).IsUnique();
            e.HasIndex(l => l.UserId);
        });
    }

    /// <summary>Short lists of ids, stored as JSON text (portable across PostgreSQL and the test database).</summary>
    private static class StringList
    {
        public static readonly Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<List<string>, string> Converter = new(
            v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
            v => JsonSerializer.Deserialize<List<string>>(v, (JsonSerializerOptions?)null) ?? new List<string>());

        public static readonly ValueComparer<List<string>> Comparer = new(
            (a, b) => (a ?? new List<string>()).SequenceEqual(b ?? new List<string>()),
            v => v.Aggregate(0, (h, s) => HashCode.Combine(h, s.GetHashCode())),
            v => v.ToList());
    }
}
