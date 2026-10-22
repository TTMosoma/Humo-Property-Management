using Humo.Infrastructure.Data;
using Humo.Infrastructure.Documents;
using Humo.Infrastructure.Files;
using Humo.Infrastructure.Messaging;
using Humo.Infrastructure.Payments;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Humo.Infrastructure;

public static class InfrastructureServices
{
    /// <summary>The database (PostgreSQL), Data Protection keys in it, email and SMS.</summary>
    public static IServiceCollection AddHumoInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        var connection = config.GetConnectionString("Humo")
            ?? throw new InvalidOperationException("ConnectionStrings:Humo is missing (see backend/deploy/.env.example).");
        services.AddDbContext<HumoDbContext>(o => o.UseNpgsql(connection));

        // Sign-in cookies and one-time codes are encrypted with these keys: keep them in the database, so they're backed up (doc 26 §3).
        services.AddDataProtection().SetApplicationName("Humo").PersistKeysToDbContext<HumoDbContext>();

        services.AddOptions<MailOptions>().Bind(config.GetSection(MailOptions.Section)).ValidateOnStart()
            .Validate(o => o.Provider is "Smtp" or "Log", "Mail:Provider must be Smtp or Log.")
            .Validate(o => o.Provider != "Smtp" || !string.IsNullOrWhiteSpace(o.Host), "Mail:Host is required for SMTP.");
        services.AddSingleton<SmtpEmailSender>();
        services.AddSingleton<LogEmailSender>();
        services.AddSingleton<IEmailSender>(sp => sp.GetRequiredService<IOptions<MailOptions>>().Value.Provider == "Log"
            ? sp.GetRequiredService<LogEmailSender>()
            : sp.GetRequiredService<SmtpEmailSender>());

        // Uploaded files (R-11): a signing key is required, and it must be a real 256-bit key.
        services.AddOptions<FilesOptions>().Bind(config.GetSection(FilesOptions.Section)).ValidateOnStart()
            .Validate(o => !string.IsNullOrWhiteSpace(o.SigningKey) && TryDecodeKey(o.SigningKey), "Files:SigningKey must be a base64 key of at least 32 bytes (openssl rand -base64 32).")
            .Validate(o => o.MaxBytes > 0, "Files:MaxBytes must be positive.");
        services.AddSingleton<IFileStore, LocalFileStore>();
        services.AddSingleton<IFileScanner, ClamAvScanner>();

        services.AddOptions<SmsOptions>().Bind(config.GetSection(SmsOptions.Section));
        services.AddSingleton<ISmsSender, LogSmsSender>();
        // SMSSouthAfrica (D14): Sms__Provider=SmsSouthAfrica plus its Sms__SmsSouthAfrica__* settings.
        services.AddOptions<SmsSouthAfricaOptions>().Bind(config.GetSection(SmsSouthAfricaOptions.Section));
        services.AddHttpClient(SmsSouthAfricaSender.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(20));
        services.AddSingleton<ISmsSender, SmsSouthAfricaSender>();
        services.AddSingleton<SmsGateway>();

        // Payfast (D15): Payments__Payfast__*. Sandbox by default; production sets Sandbox=false with the live merchant.
        services.AddOptions<PayfastOptions>().Bind(config.GetSection(PayfastOptions.Section));
        services.AddHttpClient(PayfastClient.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(20));
        services.AddSingleton<IPayfast, PayfastClient>();

        // Statement PDFs (D7, D8): headless Chromium prints the app's print route. Documents__ChromiumPath in the Docker image.
        services.AddOptions<DocumentOptions>().Bind(config.GetSection(DocumentOptions.Section));
        services.AddSingleton<IPdfRenderer, ChromiumPdfRenderer>();

        return services;
    }

    /// <summary>A signing key is base64 and at least 256 bits.</summary>
    private static bool TryDecodeKey(string key)
    {
        try { return Convert.FromBase64String(key).Length >= 32; }
        catch (FormatException) { return false; }
    }
}
