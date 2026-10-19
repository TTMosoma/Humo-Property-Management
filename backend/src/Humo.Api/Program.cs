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
builder.Services.AddProblemDetails();

builder.Services.AddHumoInfrastructure(config);
builder.Services.AddScoped<SessionBuilder>();
builder.Services.AddScoped<AuditLog>();
builder.Services.AddScoped<CurrentActor>();
builder.Services.AddScoped<CommandRunner>();
builder.Services.AddScoped<PortfolioReads>();
builder.Services.AddScoped<Notices>();
builder.Services.AddScoped<Humo.Api.Commercial.CommercialRecords>();
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
    o.ExpireTimeSpan = TimeSpan.FromHours(12);
    o.SlidingExpiration = true;
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
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

// Behind Caddy on the VPS: trust its X-Forwarded-For/Proto. The API's port is only reachable from Caddy (docker network).
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

var api = app.MapGroup("/api");
api.MapGet("/health", async (HumoDbContext db, CancellationToken ct) =>
    await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ok" }) : Results.Problem("Database unavailable", statusCode: 503));
api.MapHumoAuth();
api.MapSmsWebhooks();
api.MapOrganisations();
api.MapSchemes();
api.MapUnits();
api.MapPeople();
api.MapBoards();
api.MapAccess();
api.MapAccountRequests();
api.MapHumoTeam();
api.MapImpersonation();
api.MapAudit();
api.MapSecurity();
Humo.Api.Commercial.CustomerEndpoints.MapCustomers(api);
Humo.Api.Commercial.CommercialEndpoints.MapCommercial(api);
Notices.MapNotifications(api);

await app.InitialiseDatabaseAsync();
app.Run();

/// <summary>Exposed for the API tests (WebApplicationFactory).</summary>
public partial class Program;
