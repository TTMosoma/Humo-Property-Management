using System.Collections.Concurrent;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Humo.Api.Tests;

/// <summary>
/// The real API, with an in-memory SQLite database (no Docker needed), a clock
/// the test controls and email captured instead of sent. One per test, so
/// every test starts from an empty platform with only the bootstrap administrator.
/// </summary>
public sealed class HumoApiFactory : WebApplicationFactory<Program>
{
    public const string AdminEmail = "admin@humo.co.za";

    private readonly SqliteConnection connection = new("DataSource=:memory:");
    private readonly Dictionary<string, string?> settings = new()
    {
        ["ConnectionStrings:Humo"] = "Host=unused-in-tests",
        ["Database:Initialise"] = "EnsureCreated",
        ["Mail:Provider"] = "Log",
        // The tests run the billing run themselves (POST /api/platform/billing/run).
        ["Billing:Enabled"] = "false",
        // Tests that move the clock sign in again many times a (real) minute.
        ["Auth:SignInRequestsPerMinute"] = "1000",
        ["Bootstrap:AdminEmail"] = AdminEmail,
        ["Bootstrap:AdminName"] = "Ayanda Admin",
        ["App:PublicUrl"] = "https://localhost",
        ["App:PasskeyDomain"] = "localhost",
        ["App:AllowedOrigins:0"] = "https://localhost",
    };

    public TestClock Clock { get; } = new();
    public CapturedEmail Email { get; } = new();
    public TestPdfRenderer Pdf { get; }

    public HumoApiFactory() => Pdf = new TestPdfRenderer(this);

    public HumoApiFactory With(string key, string? value)
    {
        settings[key] = value;
        return this;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        connection.Open();
        builder.UseEnvironment("Testing");
        // UseSetting, not ConfigureAppConfiguration: Program reads some settings before Build().
        foreach (var (key, value) in settings) builder.UseSetting(key, value);
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<DbContextOptions<HumoDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<HumoDbContext>>();
            services.AddDbContext<HumoDbContext>(o => o.UseSqlite(connection));
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(Email);
            // Payfast's real checks call Payfast; the tests check the signature only.
            services.RemoveAll<Humo.Infrastructure.Payments.IPayfast>();
            services.AddSingleton<Humo.Infrastructure.Payments.IPayfast, TestPayfast>();
            // A passkey ceremony needs a person at a device: tests prove step-up with the credential "test-passkey".
            services.RemoveAll<Humo.Api.Auth.IStepUpVerifier>();
            services.AddScoped<Humo.Api.Auth.IStepUpVerifier, TestStepUp>();
            // No Chromium in tests: the renderer reads the print route's data with the print token, as Chromium would.
            services.RemoveAll<Humo.Infrastructure.Documents.IPdfRenderer>();
            services.AddSingleton<Humo.Infrastructure.Documents.IPdfRenderer>(Pdf);
        });
    }

    public HttpClient Client() => CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });

    public async Task<T> Db<T>(Func<HumoDbContext, Task<T>> work)
    {
        using var scope = Services.CreateScope();
        return await work(scope.ServiceProvider.GetRequiredService<HumoDbContext>());
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing) connection.Dispose();
    }
}

public sealed class TestStepUp : Humo.Api.Auth.IStepUpVerifier
{
    public Task<string?> VerifyAsync(HumoUser user, string credentialJson) =>
        Task.FromResult(credentialJson == "\"test-passkey\"" ? null : "Not the test passkey");
}

/// <summary>Payfast's sandbox merchant and real signatures; a notification counts as genuine when its signature matches.</summary>
public sealed class TestPayfast : Humo.Infrastructure.Payments.IPayfast
{
    private readonly Humo.Infrastructure.Payments.PayfastClient real = new(
        Microsoft.Extensions.Options.Options.Create(new Humo.Infrastructure.Payments.PayfastOptions()), null!,
        Microsoft.Extensions.Logging.Abstractions.NullLogger<Humo.Infrastructure.Payments.PayfastClient>.Instance);

    public bool Configured => true;
    public bool Sandbox => true;

    public Humo.Infrastructure.Payments.PayfastCheckout Checkout(string paymentId, decimal amount, string itemName, string? itemDescription, string? email,
        string returnUrl, string cancelUrl, string notifyUrl, string invoiceId, bool saveCard = false) =>
        real.Checkout(paymentId, amount, itemName, itemDescription, email, returnUrl, cancelUrl, notifyUrl, invoiceId, saveCard);

    /// <summary>Card charges and cancellations the API asked Payfast for. <see cref="Refuse"/> stands in for a declined card.</summary>
    public System.Collections.Concurrent.ConcurrentQueue<(string Token, decimal Amount, string PaymentId)> Charges { get; } = new();
    public System.Collections.Concurrent.ConcurrentQueue<string> Cancelled { get; } = new();
    public bool Refuse { get; set; }

    public Task<Humo.Infrastructure.Payments.PayfastApiResult> ChargeAsync(string token, decimal amount, string itemName, string paymentId, CancellationToken ct)
    {
        if (Refuse) return Task.FromResult(new Humo.Infrastructure.Payments.PayfastApiResult(false, "Card declined"));
        Charges.Enqueue((token, amount, paymentId));
        return Task.FromResult(new Humo.Infrastructure.Payments.PayfastApiResult(true, "success"));
    }

    public Task<Humo.Infrastructure.Payments.PayfastApiResult> CancelAsync(string token, CancellationToken ct)
    {
        Cancelled.Enqueue(token);
        return Task.FromResult(new Humo.Infrastructure.Payments.PayfastApiResult(true, "success"));
    }

    public Task<string?> VerifyAsync(Humo.Infrastructure.Payments.PayfastNotification n, System.Net.IPAddress? from, CancellationToken ct) =>
        Task.FromResult(Humo.Infrastructure.Payments.PayfastClient.Signature(n.Fields.Where(f => f.Key != "signature"), null) == n["signature"]
            ? null : "The signature doesn't match");
}

public sealed class TestClock : TimeProvider
{
    private DateTimeOffset now = new(2026, 10, 19, 8, 0, 0, TimeSpan.Zero);

    public override DateTimeOffset GetUtcNow() => now;

    public void Advance(TimeSpan by) => now += by;
}

public sealed class CapturedEmail : IEmailSender
{
    public ConcurrentQueue<EmailMessage> Sent { get; } = new();

    /// <summary>Stands in for a mail server that's down.</summary>
    public bool Failing { get; set; }

    public Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        if (Failing) throw new InvalidOperationException("The mail server is down");
        Sent.Enqueue(message);
        return Task.CompletedTask;
    }
}

/// <summary>Stands in for Chromium: fetches the print route's snapshot with the token in the URL and "prints" it.</summary>
public sealed class TestPdfRenderer(HumoApiFactory api) : Humo.Infrastructure.Documents.IPdfRenderer
{
    public ConcurrentQueue<string> Urls { get; } = new();
    public bool Failing { get; set; }

    public async Task<byte[]> RenderAsync(string url, CancellationToken ct = default)
    {
        Urls.Enqueue(url);
        if (Failing) throw new InvalidOperationException("Chromium crashed");
        var token = url[(url.LastIndexOf('/') + 1)..];
        var res = await api.Client().GetAsync($"/api/print/statements/{token}", ct);
        res.EnsureSuccessStatusCode();
        return System.Text.Encoding.UTF8.GetBytes("%PDF-1.7 test\n" + await res.Content.ReadAsStringAsync(ct));
    }
}
