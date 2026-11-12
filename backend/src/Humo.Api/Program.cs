using Humo.Api.Finance;
using Humo.Api.Files;
using Humo.Api.Commercial;
using System.Threading.RateLimiting;
using Humo.Api;
using Humo.Api.Access;
using Humo.Api.Audit;
using Humo.Api.Auth;
using Humo.Api.Commands;
using Humo.Api.Messaging;
using Humo.Api.Platform;
using Humo.Api.Portfolio;
using Humo.Api.Session;
using Humo.Api.Startup;
using Humo.Infrastructure;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

builder.Services.AddOptions<AppOptions>().Bind(config.GetSection(AppOptions.Section))
    .Validate(o => Uri.TryCreate(o.PublicUrl, UriKind.Absolute, out _), "App:PublicUrl must be an absolute URL.")
    .ValidateOnStart();
builder.Services.AddOptions<BootstrapOptions>().Bind(config.GetSection(BootstrapOptions.Section));
builder.Services.AddOptions<DatabaseOptions>().Bind(config.GetSection(DatabaseOptions.Section));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpContextAccessor();
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = TechnicalLogging.NoteRefusal);
builder.AddTechnicalLogging();

builder.Services.AddHumoInfrastructure(config);
builder.Services.AddScoped<SessionBuilder>();
builder.Services.AddScoped<Humo.Api.Commercial.PackageLimits>();
builder.Services.AddScoped<Humo.Api.Auth.SignInSessions>();
builder.Services.AddScoped<AuditLog>();
builder.Services.AddScoped<CurrentActor>();
builder.Services.AddScoped<CommandRunner>();
builder.Services.AddScoped<PortfolioReads>();
builder.Services.AddScoped<Notices>();
builder.Services.AddScoped<Humo.Api.Commercial.CommercialRecords>();
builder.Services.AddScoped<Humo.Api.Commercial.BillingService>();
builder.Services.AddScoped<Humo.Api.Commercial.CardPayments>();
builder.Services.AddScoped<Humo.Api.Finance.AccountLedger>();
builder.Services.AddScoped<Humo.Api.Finance.LevyBilling>();
builder.Services.AddScoped<Humo.Api.Finance.StatementService>();
builder.Services.AddScoped<Humo.Api.Documents.DocumentLinks>();
builder.Services.AddSingleton<Humo.Api.Finance.PrintTokens>();
builder.Services.AddScoped<Humo.Api.Finance.DocumentPrinter>();
builder.Services.AddScoped<Humo.Api.Messaging.SentRecords>();
builder.Services.AddScoped<Humo.Api.Maintenance.MaintenanceService>();
builder.Services.AddScoped<Humo.Api.Work.IApprovalHandler, Humo.Api.Maintenance.QuoteApprovalHandler>();
builder.Services.AddScoped<Humo.Api.Work.IApprovalHandler, Humo.Api.Maintenance.InvoiceApprovalHandler>();
builder.Services.AddScoped<Humo.Api.Finance.Payables>();
builder.Services.AddScoped<Humo.Api.Work.IApprovalHandler, Humo.Api.Finance.PaymentBatchApprovalHandler>();
builder.Services.AddScoped<Humo.Api.Work.IApprovalHandler, Humo.Api.Finance.BankDetailsVerificationHandler>();
builder.Services.AddScoped<Humo.Api.Messaging.MessageUsage>();
builder.Services.AddScoped<Humo.Api.Work.SoleAuthority>();
builder.Services.AddScoped<Humo.Api.Work.BoardApprovals>();
builder.Services.AddScoped<Humo.Api.Maintenance.SupplierLinks>();
builder.Services.AddScoped<Humo.Api.Work.StaffCovers>();
builder.Services.AddScoped<Humo.Api.Access.EmailChanges>();
builder.Services.AddScoped<Humo.Api.Finance.Budgets>();
builder.Services.AddScoped<Humo.Api.Portfolio.SchemeHealth>();
builder.Services.AddScoped<Humo.Api.Governance.Governance>();
builder.Services.AddScoped<Humo.Api.Work.IApprovalHandler, Humo.Api.Governance.MinutesApprovalHandler>();
builder.Services.AddScoped<Humo.Api.Work.IApprovalHandler, Humo.Api.Governance.ResolutionApprovalHandler>();
builder.Services.AddScoped<Humo.Api.Messaging.EmailSignatures>();
builder.Services.AddScoped<Humo.Api.Messaging.Communications>();
builder.Services.AddScoped<Humo.Api.Messaging.Inbox>();
builder.Services.AddSingleton<Humo.Api.Finance.DeliveryQueue>();
builder.Services.AddHostedService<Humo.Api.Finance.DeliveryHost>();
builder.Services.AddScoped<Humo.Api.Finance.CreditControl>();
builder.Services.AddScoped<Humo.Api.Finance.AccountCorrections>();
builder.Services.AddScoped<Humo.Api.Work.IApprovalHandler, Humo.Api.Finance.AccountCorrectionHandler>();
builder.Services.AddScoped<Humo.Api.Work.IApprovalHandler>(sp => sp.GetRequiredService<Humo.Api.Finance.CreditControl>());
builder.Services.AddScoped<Humo.Api.Work.IApprovalHandler>(sp => sp.GetRequiredService<Humo.Api.Finance.LevyBilling>());
// The daily billing run (Billing:Enabled, Billing:RunHour): invoices, card charges, reminders.
builder.Services.AddHostedService<Humo.Api.Commercial.BillingRunHost>();
builder.Services.AddScoped<IStepUpVerifier, PasskeyStepUpVerifier>();

// ---- Sign-in: ASP.NET Core Identity with passkeys; no passwords (D14) ----
builder.Services
    .AddIdentityCore<HumoUser>(o =>
    {
        o.Stores.SchemaVersion = IdentitySchemaVersions.Version3; // includes passkeys
        o.User.RequireUniqueEmail = true;
        o.SignIn.RequireConfirmedAccount = false;
    })
    .AddSignInManager()
    .AddEntityFrameworkStores<HumoDbContext>()
    .AddDefaultTokenProviders();

var app0 = config.GetSection(AppOptions.Section).Get<AppOptions>() ?? new AppOptions();
builder.Services.Configure<IdentityPasskeyOptions>(o =>
{
    // The relying-party ID: pm.humo.co.za in production. Never change it (doc 25).
    o.ServerDomain = app0.PasskeyDomain;
    o.ResidentKeyRequirement = "required"; // discoverable: "Sign in with a passkey" works without typing an email
    o.UserVerificationRequirement = "required";
    o.ValidateOrigin = ctx => ValueTask.FromResult(!ctx.CrossOrigin && app0.AllowedOrigins.Contains(ctx.Origin, StringComparer.OrdinalIgnoreCase));
});

builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();
builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.Name = "humo.session";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Lax; // Lax so links from emails open signed in
    o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    // The session's own limits (Auth/SessionPolicy) decide when it ends; the cookie only carries its id.
    o.ExpireTimeSpan = TimeSpan.FromHours(12);
    o.SlidingExpiration = false;
    // An API answers 401/403; it never redirects to a login page.
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
});
// A suspended person's cookie stops working within minutes, not hours.
builder.Services.Configure<SecurityStampValidatorOptions>(o =>
{
    o.ValidationInterval = TimeSpan.FromMinutes(5);
    // The refresh rebuilds the session from the user record: keep Humo's own claims (active role,
    // step-up time, impersonation), or they'd silently drop every 5 minutes.
    o.OnRefreshingPrincipal = ctx =>
    {
        var keep = ctx.CurrentPrincipal?.Claims.Where(c => c.Type.StartsWith("humo:", StringComparison.Ordinal)).ToList() ?? [];
        if (keep.Count > 0 && ctx.NewPrincipal?.Identity is System.Security.Claims.ClaimsIdentity identity) identity.AddClaims(keep);
        return Task.CompletedTask;
    };
});
builder.Services.AddAuthorization();

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy(RateLimits.SignIn, ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = config.GetValue("Auth:SignInRequestsPerMinute", 10), Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy(RateLimits.DocumentLinks, ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = config.GetValue("Documents:LinkRequestsPerMinute", 30), Window = TimeSpan.FromMinutes(1) }));
});

// Behind Caddy on the VPS: trust its X-Forwarded-For/Proto. The API's port is only reachable from Caddy (docker network).
// Forwarded headers are believed only from Caddy (App:TrustedProxies). Anyone else's X-Forwarded-For or X-Forwarded-Proto is ignored.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
    foreach (var proxy in config.GetSection(AppOptions.Section).Get<AppOptions>()?.TrustedProxies ?? [])
        o.KnownProxies.Add(System.Net.IPAddress.Parse(proxy));
});

// Go-live safety (docs/18 D-4, D-17, D-18): in Production, nothing switched off or in test mode.
Humo.Api.Startup.ProductionSettings.Check(builder.Environment, builder.Configuration);

var app = builder.Build();

app.UseForwardedHeaders();
app.UseTechnicalRequestLogging(); // outside the exception handler, so a failure is logged with its 500
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseRateLimiter();
app.UseAuthentication();
app.UseMiddleware<Humo.Api.Auth.SessionGuard>(); // a session the policy has ended counts as signed out
app.UseAuthorization();

var api = app.MapGroup("/api");
api.MapGet("/health", async (HumoDbContext db, CancellationToken ct) =>
    await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ok", version = Humo.Api.AppVersion.Current }) : Results.Problem("Database unavailable", statusCode: 503));
api.MapHumoAuth();
api.MapSmsWebhooks();
api.MapMailWebhooks();
api.MapFiles();
api.MapPackageLimits();
api.MapOwnerInvoices();
api.MapOrganisations();
api.MapSchemes();
api.MapUnits();
api.MapPeople();
Humo.Api.Maintenance.JobPhotoEndpoints.MapJobPhotos(api);
Humo.Api.Maintenance.SupplierLinkEndpoints.MapSupplierLinks(api);
Humo.Api.Access.EmailChangeEndpoints.MapEmailChanges(api);
Humo.Api.Portfolio.PastResidentEndpoints.MapPastResident(api);
api.MapBoards();
api.MapAccess();
api.MapAccountRequests();
api.MapHumoTeam();
api.MapTechnicalLogs();
api.MapImpersonation();
Humo.Api.Platform.PasskeyResetEndpoints.MapPasskeyReset(api);
Humo.Api.Auth.SmsStepUp.MapSmsStepUp(api);
api.MapAudit();
api.MapSecurity();
Humo.Api.Commercial.CustomerEndpoints.MapCustomers(api);
Humo.Api.Commercial.CommercialEndpoints.MapCommercial(api);
Humo.Api.Commercial.BillingEndpoints.MapBilling(api);
Humo.Api.Commercial.PayfastEndpoints.MapPayfast(api);
Humo.Api.Finance.LevyCardPayments.MapLevyCardPayments(api);
Humo.Api.Finance.AccountEndpoints.MapAccounts(api);
Humo.Api.Finance.AccountCorrectionEndpoints.MapAccountCorrections(api);
Humo.Api.Portfolio.TimelineEndpoints.MapTimeline(api);
Humo.Api.Finance.ReceiptEndpoints.MapReceipts(api);
Humo.Api.Finance.BillingRunEndpoints.MapBillingRuns(api);
Humo.Api.Finance.MeterEndpoints.MapMetersAndLevies(api);
Humo.Api.Work.WorkItemEndpoints.MapWorkItems(api);
Humo.Api.Work.StaffEndpoints.MapStaff(api);
Humo.Api.Finance.BudgetEndpoints.MapBudgets(api);
Humo.Api.Portfolio.ReportEndpoints.MapReports(api);
Humo.Api.Platform.FeatureSwitches.MapFeatureSwitches(api);
Humo.Api.Governance.GovernanceEndpoints.MapGovernance(api);
Humo.Api.Governance.SchemeRules.MapSchemeRules(api);
Humo.Api.Settings.ComplianceProfiles.MapComplianceProfiles(api);
Humo.Api.Work.TrusteePermissionEndpoints.MapTrusteePermissions(api);
Humo.Api.Work.BoardApprovalEndpoints.MapBoardApprovals(api);
Humo.Api.Finance.StatementEndpoints.MapStatements(api);
Humo.Api.Documents.DocumentLinkEndpoints.MapDocumentLinks(api);
Humo.Api.Finance.CreditControlEndpoints.MapCreditControl(api);
Humo.Api.Messaging.SentEndpoints.MapSent(api);
Humo.Api.Messaging.CommunicationsEndpoints.MapCommunications(api);
Humo.Api.Messaging.InboxEndpoints.MapInbox(api);
Humo.Api.Maintenance.MaintenanceEndpoints.MapMaintenance(api);
Humo.Api.Finance.PayablesEndpoints.MapPayables(api);
Humo.Api.Settings.SettingsEndpoints.MapSettings(api);
Humo.Api.Documents.DocumentEndpoints.MapDocuments(api);
Humo.Api.Documents.TemplateRegistry.MapPlatformTemplates(api);
Notices.MapNotifications(api);

// Operator check (doc 26): `send-test-sms <mobile number>` sends one SMS through the configured provider, then exits.
if (args is ["send-test-sms", var to])
{
    using var scope = app.Services.CreateScope();
    var receipt = await scope.ServiceProvider.GetRequiredService<Humo.Infrastructure.Messaging.SmsGateway>()
        .SendAsync(new Humo.Infrastructure.Messaging.SmsMessage(to, "Humo Property Management: test message. If this reached you, SMS is set up.", $"test-{Guid.NewGuid():N}"[..20]));
    Console.WriteLine(receipt.Accepted
        ? $"Accepted by {receipt.Provider} (message {receipt.ProviderMessageId ?? "no id"})."
        : $"Refused by {receipt.Provider}: {receipt.Error}");
    return;
}

await app.InitialiseDatabaseAsync();

// Development only (docs/28 §1): `seed-demo` loads the demo agencies into the local database, then exits.
if (args is [Humo.Api.Startup.DevSeed.Command])
{
    Console.WriteLine(await Humo.Api.Startup.DevSeed.RunAsync(app.Services, app.Environment));
    return;
}

app.Run();

/// <summary>Exposed for the API tests (WebApplicationFactory).</summary>
public partial class Program;
