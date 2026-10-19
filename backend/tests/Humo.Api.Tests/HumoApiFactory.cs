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
        ["Bootstrap:AdminEmail"] = AdminEmail,
        ["Bootstrap:AdminName"] = "Ayanda Admin",
        ["App:PublicUrl"] = "https://localhost",
        ["App:PasskeyDomain"] = "localhost",
        ["App:AllowedOrigins:0"] = "https://localhost",
    };

    public TestClock Clock { get; } = new();
    public CapturedEmail Email { get; } = new();

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
            // A passkey ceremony needs a person at a device: tests prove step-up with the credential "test-passkey".
            services.RemoveAll<Humo.Api.Auth.IStepUpVerifier>();
            services.AddScoped<Humo.Api.Auth.IStepUpVerifier, TestStepUp>();
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
