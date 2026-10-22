using System.Text.Json;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

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
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<Agreement> Agreements => Set<Agreement>();
    public DbSet<UpgradeRequest> UpgradeRequests => Set<UpgradeRequest>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<LedgerEntry> Ledger => Set<LedgerEntry>();
    public DbSet<Receipt> Receipts => Set<Receipt>();
    public DbSet<ReceiptAllocation> ReceiptAllocations => Set<ReceiptAllocation>();
    public DbSet<PayerRule> PayerRules => Set<PayerRule>();
    public DbSet<StatementMappingSetting> StatementMappings => Set<StatementMappingSetting>();
    public DbSet<StatementImport> StatementImports => Set<StatementImport>();
    public DbSet<BillingRunRow> BillingRuns => Set<BillingRunRow>();
    public DbSet<WorkItemRow> WorkItems => Set<WorkItemRow>();
    public DbSet<WaterSetting> WaterSettings => Set<WaterSetting>();
    public DbSet<MeterReading> MeterReadings => Set<MeterReading>();
    public DbSet<LevySetting> LevySettings => Set<LevySetting>();
    public DbSet<AgencySetting> AgencySettings => Set<AgencySetting>();
    public DbSet<DocumentSetting> DocumentSettings => Set<DocumentSetting>();
    public DbSet<TrustAccountRow> TrustAccounts => Set<TrustAccountRow>();
    public DbSet<IssuedStatement> IssuedStatements => Set<IssuedStatement>();
    public DbSet<PersonalPreference> PersonalPreferences => Set<PersonalPreference>();
    public DbSet<CollectionCaseRow> CollectionCases => Set<CollectionCaseRow>();
    public DbSet<IssuedLetter> IssuedLetters => Set<IssuedLetter>();
    public DbSet<SentMessageRow> SentMessages => Set<SentMessageRow>();
    public DbSet<DeliveryRow> Deliveries => Set<DeliveryRow>();
    public DbSet<MessageTemplateRow> MessageTemplates => Set<MessageTemplateRow>();
    public DbSet<NoticeRow> SchemeNotices => Set<NoticeRow>();
    public DbSet<ConversationRow> Conversations => Set<ConversationRow>();
    public DbSet<MessageUsageRow> MessageUsage => Set<MessageUsageRow>();
    public DbSet<SupplierRow> Suppliers => Set<SupplierRow>();
    public DbSet<JobRow> Jobs => Set<JobRow>();
    public DbSet<SupplierInvoiceRow> SupplierInvoices => Set<SupplierInvoiceRow>();
    public DbSet<Payment> Payments => Set<Payment>();
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
    public DbSet<UserSession> UserSessions => Set<UserSession>();
    public DbSet<TrustedBrowser> TrustedBrowsers => Set<TrustedBrowser>();
    public DbSet<UploadedFile> UploadedFiles => Set<UploadedFile>();
    public DbSet<LibraryDocument> LibraryDocuments => Set<LibraryDocument>();
    public DbSet<DocumentLink> DocumentLinks => Set<DocumentLink>();
    public DbSet<ImpersonationSession> ImpersonationSessions => Set<ImpersonationSession>();
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    /// <summary>
    /// Every time is stored in UTC: PostgreSQL's timestamptz takes no other offset, and code often builds
    /// South African times (+02:00) for due dates and expiries.
    /// </summary>
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        base.ConfigureConventions(configurationBuilder);
        configurationBuilder.Properties<DateTimeOffset>().HaveConversion<UtcDateTimeOffset>();
    }

    private sealed class UtcDateTimeOffset() : ValueConverter<DateTimeOffset, DateTimeOffset>(v => v.ToUniversalTime(), v => v);

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
            e.Property(o => o.ApprovalStepUpAmount).HasPrecision(18, 2).HasDefaultValue(50_000m);
            e.Property(o => o.InterestPercentPerMonth).HasPrecision(5, 2).HasDefaultValue(2m);
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

        builder.Entity<Subscription>(e =>
        {
            e.ToTable("Subscriptions");
            e.HasKey(x => x.OrganisationId);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasOne<Organisation>().WithOne().HasForeignKey<Subscription>(x => x.OrganisationId);
        });

        builder.Entity<Agreement>(e =>
        {
            e.ToTable("Agreements");
            e.HasKey(x => x.OrganisationId);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasOne<Organisation>().WithOne().HasForeignKey<Agreement>(x => x.OrganisationId);
        });

        builder.Entity<UpgradeRequest>(e =>
        {
            e.ToTable("UpgradeRequests");
            e.Property(x => x.Source).HasMaxLength(20);
            e.Property(x => x.Status).HasMaxLength(20);
            e.HasIndex(x => x.OrganisationId);
            e.HasOne<Organisation>().WithMany().HasForeignKey(x => x.OrganisationId);
        });

        builder.Entity<LedgerEntry>(e =>
        {
            e.ToTable("Ledger");
            e.Property(x => x.Type).HasMaxLength(20);
            e.Property(x => x.Description).HasMaxLength(300);
            e.Property(x => x.Reference).HasMaxLength(100);
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.HasIndex(x => new { x.AccountId, x.Date });
            e.HasIndex(x => x.ReceiptId);
            e.HasOne<LevyAccount>().WithMany().HasForeignKey(x => x.AccountId);
        });

        builder.Entity<Receipt>(e =>
        {
            e.ToTable("Receipts");
            e.Property(x => x.Reference).HasMaxLength(200);
            e.Property(x => x.Payer).HasMaxLength(200);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.Source).HasMaxLength(20);
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => new { x.SchemeId, x.Status });
            e.HasOne<Scheme>().WithMany().HasForeignKey(x => x.SchemeId);
            e.HasMany(x => x.Allocations).WithOne().HasForeignKey(x => x.ReceiptId);
        });

        builder.Entity<ReceiptAllocation>(e =>
        {
            e.ToTable("ReceiptAllocations");
            e.HasKey(x => new { x.ReceiptId, x.AccountId });
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.HasOne<LevyAccount>().WithMany().HasForeignKey(x => x.AccountId);
        });

        builder.Entity<PayerRule>(e =>
        {
            e.ToTable("PayerRules");
            e.Property(x => x.Pattern).HasMaxLength(200);
            e.HasIndex(x => x.SchemeId);
        });

        builder.Entity<StatementMappingSetting>(e =>
        {
            e.ToTable("StatementMappings");
            e.HasKey(x => x.SchemeId);
        });

        builder.Entity<StatementImport>(e =>
        {
            e.ToTable("StatementImports");
            e.Property(x => x.Total).HasPrecision(18, 2);
            e.HasIndex(x => x.SchemeId);
        });

        builder.Entity<BillingRunRow>(e =>
        {
            e.ToTable("BillingRuns");
            e.Property(x => x.Ref).HasMaxLength(30);
            e.Property(x => x.Period).HasMaxLength(7);
            e.Property(x => x.Stage).HasMaxLength(20);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => x.Ref).IsUnique();
            e.HasIndex(x => new { x.SchemeId, x.Period });
            e.HasOne<Scheme>().WithMany().HasForeignKey(x => x.SchemeId);
        });

        builder.Entity<WorkItemRow>(e =>
        {
            e.ToTable("WorkItems");
            e.Property(x => x.Ref).HasMaxLength(40);
            e.Property(x => x.Kind).HasMaxLength(20);
            e.Property(x => x.Type).HasMaxLength(40);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.HasIndex(x => new { x.OrganisationId, x.Status });
            e.HasIndex(x => x.SourceId);
        });

        builder.Entity<WaterSetting>(e =>
        {
            e.ToTable("WaterSettings");
            e.HasKey(x => x.SchemeId);
            e.Property(x => x.RatePerKl).HasPrecision(10, 2);
            e.Property(x => x.Version).IsConcurrencyToken();
        });

        builder.Entity<MeterReading>(e =>
        {
            e.ToTable("MeterReadings");
            e.Property(x => x.Period).HasMaxLength(7);
            e.Property(x => x.Reading).HasPrecision(12, 2);
            e.HasIndex(x => new { x.UnitId, x.Period }).IsUnique();
            e.HasIndex(x => new { x.SchemeId, x.Period });
        });

        builder.Entity<LevySetting>(e =>
        {
            e.ToTable("LevySettings");
            e.HasKey(x => x.SchemeId);
            e.Property(x => x.Method).HasMaxLength(10);
            e.Property(x => x.Version).IsConcurrencyToken();
        });

        builder.Entity<AgencySetting>(e =>
        {
            e.ToTable("AgencySettings");
            e.HasKey(x => x.OrganisationId);
            e.Property(x => x.RegistrationNumber).HasMaxLength(20);
            e.Property(x => x.VatNumber).HasMaxLength(10);
            e.Property(x => x.FfcNumber).HasMaxLength(30);
            e.Property(x => x.Address).HasMaxLength(200);
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.Phone).HasMaxLength(30);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasOne<Organisation>().WithOne().HasForeignKey<AgencySetting>(x => x.OrganisationId);
        });

        builder.Entity<DocumentSetting>(e =>
        {
            e.ToTable("DocumentSettings");
            e.HasKey(x => x.OrganisationId);
            e.Property(x => x.ContactEmail).HasMaxLength(254);
            e.Property(x => x.ContactPhone).HasMaxLength(30);
            e.Property(x => x.FooterText).HasMaxLength(200);
            e.Property(x => x.StatementDelivery).HasMaxLength(12);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasOne<Organisation>().WithOne().HasForeignKey<DocumentSetting>(x => x.OrganisationId);
        });

        builder.Entity<TrustAccountRow>(e =>
        {
            e.ToTable("TrustAccounts");
            e.HasKey(x => x.SchemeId);
            e.Property(x => x.Bank).HasMaxLength(60);
            e.Property(x => x.AccountName).HasMaxLength(120);
            e.Property(x => x.AccountNumber).HasMaxLength(20);
            e.Property(x => x.BranchCode).HasMaxLength(10);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasOne<Scheme>().WithOne().HasForeignKey<TrustAccountRow>(x => x.SchemeId);
        });

        builder.Entity<IssuedStatement>(e =>
        {
            e.ToTable("IssuedStatements");
            e.Property(x => x.Period).HasMaxLength(7);
            e.Property(x => x.TemplateId).HasMaxLength(80);
            e.Property(x => x.SnapshotSha256).HasMaxLength(64);
            e.Property(x => x.PdfSha256).HasMaxLength(64);
            e.Property(x => x.IssuedBy).HasMaxLength(200);
            e.Property(x => x.SentBy).HasMaxLength(10);
            // One statement per account per month: issuing twice is refused by the database too.
            e.HasIndex(x => new { x.AccountId, x.Period }).IsUnique();
            e.HasIndex(x => new { x.SchemeId, x.Period });
            e.HasIndex(x => x.BillingRunId);
            e.HasOne<LevyAccount>().WithMany().HasForeignKey(x => x.AccountId);
        });

        builder.Entity<PersonalPreference>(e =>
        {
            e.ToTable("PersonalPreferences");
            e.HasKey(x => x.UserId);
            e.Property(x => x.Work).HasMaxLength(60);
            e.Property(x => x.Digest).HasMaxLength(10);
            e.Property(x => x.QuietFrom).HasMaxLength(5);
            e.Property(x => x.QuietTo).HasMaxLength(5);
            e.Property(x => x.Version).IsConcurrencyToken();
        });

        builder.Entity<CollectionCaseRow>(e =>
        {
            e.ToTable("CollectionCases");
            e.HasKey(x => x.AccountId);
            e.Property(x => x.Stage).HasMaxLength(20);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => new { x.SchemeId, x.Stage });
            e.HasOne<LevyAccount>().WithOne().HasForeignKey<CollectionCaseRow>(x => x.AccountId);
        });

        builder.Entity<IssuedLetter>(e =>
        {
            e.ToTable("IssuedLetters");
            e.Property(x => x.StepId).HasMaxLength(40);
            e.Property(x => x.Kind).HasMaxLength(20);
            e.Property(x => x.Channel).HasMaxLength(10);
            e.Property(x => x.TemplateId).HasMaxLength(80);
            e.Property(x => x.SnapshotSha256).HasMaxLength(64);
            e.Property(x => x.PdfSha256).HasMaxLength(64);
            e.Property(x => x.IssuedBy).HasMaxLength(200);
            e.HasIndex(x => x.StepId).IsUnique();
            e.HasIndex(x => x.AccountId);
            e.HasOne<LevyAccount>().WithMany().HasForeignKey(x => x.AccountId);
        });

        builder.Entity<SentMessageRow>(e =>
        {
            e.ToTable("SentMessages");
            e.Property(x => x.Ref).HasMaxLength(20);
            e.Property(x => x.Kind).HasMaxLength(20);
            e.Property(x => x.Subject).HasMaxLength(300);
            e.Property(x => x.AudienceLabel).HasMaxLength(300);
            e.Property(x => x.SentBy).HasMaxLength(200);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => new { x.OrganisationId, x.Ref }).IsUnique();
            e.HasIndex(x => new { x.SchemeId, x.CreatedAt });
        });

        builder.Entity<DeliveryRow>(e =>
        {
            e.ToTable("Deliveries");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.UnitLabel).HasMaxLength(60);
            e.Property(x => x.Channel).HasMaxLength(10);
            e.Property(x => x.Address).HasMaxLength(254);
            e.Property(x => x.Status).HasMaxLength(12);
            e.Property(x => x.ProviderMessageId).HasMaxLength(60);
            e.HasIndex(x => x.SentMessageId);
            e.HasIndex(x => x.DocumentId);
            e.HasOne<SentMessageRow>().WithMany().HasForeignKey(x => x.SentMessageId);
        });

        builder.Entity<MessageTemplateRow>(e =>
        {
            e.ToTable("MessageTemplates");
            e.Property(x => x.BuiltInKey).HasMaxLength(30);
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.Category).HasMaxLength(20);
            e.Property(x => x.Subject).HasMaxLength(200);
            e.Property(x => x.UpdatedBy).HasMaxLength(200);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => x.OrganisationId);
            e.HasOne<Organisation>().WithMany().HasForeignKey(x => x.OrganisationId);
        });

        builder.Entity<NoticeRow>(e =>
        {
            e.ToTable("SchemeNotices");
            e.Property(x => x.Ref).HasMaxLength(20);
            e.Property(x => x.Title).HasMaxLength(120);
            e.Property(x => x.Audience).HasMaxLength(12);
            e.Property(x => x.Category).HasMaxLength(20);
            e.Property(x => x.PublishedBy).HasMaxLength(200);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => new { x.SchemeId, x.Ref }).IsUnique();
            e.HasOne<Scheme>().WithMany().HasForeignKey(x => x.SchemeId);
        });

        builder.Entity<ConversationRow>(e =>
        {
            e.ToTable("Conversations");
            e.Property(x => x.Ref).HasMaxLength(20);
            e.Property(x => x.Subject).HasMaxLength(200);
            e.Property(x => x.Status).HasMaxLength(10);
            e.Property(x => x.AssigneeId).HasMaxLength(40);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => new { x.OrganisationId, x.Ref }).IsUnique();
            e.HasIndex(x => new { x.SchemeId, x.Status });
            e.HasIndex(x => x.PersonId);
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.PersonId);
        });

        builder.Entity<MessageUsageRow>(e =>
        {
            e.ToTable("MessageUsage");
            e.HasKey(x => new { x.OrganisationId, x.Period, x.Channel });
            e.Property(x => x.Period).HasMaxLength(7);
            e.Property(x => x.Channel).HasMaxLength(10);
            e.HasOne<Organisation>().WithMany().HasForeignKey(x => x.OrganisationId);
        });

        builder.Entity<SupplierRow>(e =>
        {
            e.ToTable("Suppliers");
            e.Property(x => x.Name).HasMaxLength(160);
            e.Property(x => x.ContactName).HasMaxLength(120);
            e.Property(x => x.Phone).HasMaxLength(30);
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.BankAccount).HasMaxLength(60);
            e.Property(x => x.Status).HasMaxLength(10);
            e.Property(x => x.PartyId).HasMaxLength(60);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => x.OrganisationId);
            e.HasOne<Organisation>().WithMany().HasForeignKey(x => x.OrganisationId);
        });

        builder.Entity<JobRow>(e =>
        {
            e.ToTable("Jobs");
            e.Property(x => x.Ref).HasMaxLength(20);
            e.Property(x => x.Stage).HasMaxLength(20);
            e.Property(x => x.Title).HasMaxLength(120);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => new { x.OrganisationId, x.Ref }).IsUnique();
            e.HasIndex(x => new { x.SchemeId, x.Stage });
            e.HasIndex(x => x.SupplierId);
            e.HasIndex(x => x.ReportedByPersonId);
            e.HasOne<Scheme>().WithMany().HasForeignKey(x => x.SchemeId);
        });

        builder.Entity<SupplierInvoiceRow>(e =>
        {
            e.ToTable("SupplierInvoices");
            e.Property(x => x.Number).HasMaxLength(40);
            e.Property(x => x.Description).HasMaxLength(200);
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.ApprovedAmount).HasPrecision(18, 2);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.Version).IsConcurrencyToken();
            // One invoice number per supplier: the same invoice can't be captured twice.
            e.HasIndex(x => new { x.SupplierId, x.Number }).IsUnique();
            e.HasIndex(x => new { x.SchemeId, x.Status });
            e.HasOne<SupplierRow>().WithMany().HasForeignKey(x => x.SupplierId);
        });

        builder.Entity<Invoice>(e =>
        {
            e.ToTable("Invoices");
            e.Property(x => x.Reference).HasMaxLength(40);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.PeriodStart).HasMaxLength(10);
            e.Property(x => x.IssuedOn).HasMaxLength(10);
            e.Property(x => x.DueOn).HasMaxLength(10);
            e.Property(x => x.Total).HasPrecision(18, 2);
            // Issuing is atomic: one invoice per reference, so a period can't be invoiced twice.
            e.HasIndex(x => x.Reference).IsUnique();
            e.HasIndex(x => x.OrganisationId);
            e.HasOne<Organisation>().WithMany().HasForeignKey(x => x.OrganisationId);
        });

        builder.Entity<Payment>(e =>
        {
            e.ToTable("Payments");
            e.Property(x => x.Method).HasMaxLength(20);
            e.Property(x => x.Status).HasMaxLength(30);
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.HasIndex(x => x.InvoiceId);
            e.HasOne<Invoice>().WithMany().HasForeignKey(x => x.InvoiceId);
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
            e.Property(x => x.Balance).HasPrecision(18, 2); foreach (var p in new[] { "AgeingCurrent", "AgeingD30", "AgeingD60", "AgeingD90", "AgeingD120" }) e.Property<decimal>(p).HasPrecision(18, 2);
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

        builder.Entity<ImpersonationSession>(e =>
        {
            e.ToTable("ImpersonationSessions");
            e.HasIndex(x => x.ActorId);
        });

        builder.Entity<SignInLink>(e =>
        {
            e.ToTable("SignInLinks");
            e.HasIndex(l => l.TokenHash).IsUnique();
            e.HasIndex(l => l.UserId);
            e.Property(l => l.CodeHash).HasMaxLength(64);
        });

        builder.Entity<UserSession>(e =>
        {
            e.ToTable("UserSessions");
            e.HasIndex(s => s.UserId);
            e.Property(s => s.Method).HasMaxLength(20);
            e.Property(s => s.Device).HasMaxLength(120);
            e.Property(s => s.Ip).HasMaxLength(64);
        });

        builder.Entity<LibraryDocument>(e =>
        {
            e.ToTable("LibraryDocuments");
            e.HasIndex(d => d.SchemeId);
            e.HasIndex(d => d.FileId).IsUnique();
            e.Property(d => d.RecordKind).HasMaxLength(20);
            e.Property(d => d.Title).HasMaxLength(200);
            e.Property(d => d.Category).HasMaxLength(30);
            e.Property(d => d.Visibility).HasMaxLength(20);
            e.Property(d => d.UploadedBy).HasMaxLength(200);
            e.Property(d => d.ArchivedBy).HasMaxLength(200);
            e.Property(d => d.ArchiveReason).HasMaxLength(500);
        });

        builder.Entity<UploadedFile>(e =>
        {
            e.ToTable("UploadedFiles");
            e.HasIndex(f => f.SchemeId);
            e.HasIndex(f => f.StorageKey).IsUnique();
            e.Property(f => f.Name).HasMaxLength(200);
            e.Property(f => f.ContentType).HasMaxLength(100);
            e.Property(f => f.Sha256).HasMaxLength(64);
            e.Property(f => f.StorageKey).HasMaxLength(64);
            e.Property(f => f.ScanResult).HasMaxLength(20);
            e.Property(f => f.UploadedBy).HasMaxLength(200);
        });

        builder.Entity<TrustedBrowser>(e =>
        {
            e.ToTable("TrustedBrowsers");
            e.HasIndex(t => t.TokenHash).IsUnique();
            e.HasIndex(t => t.UserId);
            e.Property(t => t.Trusted).HasDefaultValue(true);
            e.Property(t => t.TokenHash).HasMaxLength(64);
            e.Property(t => t.Label).HasMaxLength(120);
        });

        builder.Entity<DocumentLink>(e =>
        {
            e.ToTable("DocumentLinks");
            e.HasIndex(l => l.TokenHash).IsUnique();
            e.HasIndex(l => l.DocumentId);
            e.Property(l => l.Kind).HasMaxLength(20);
            e.Property(l => l.TokenHash).HasMaxLength(64);
            e.Property(l => l.CodeHash).HasMaxLength(64);
            e.Property(l => l.GrantHash).HasMaxLength(64);
            e.Property(l => l.CodesDay).HasMaxLength(10);
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
