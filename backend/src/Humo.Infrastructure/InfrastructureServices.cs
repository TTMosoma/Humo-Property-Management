using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
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

        services.AddOptions<SmsOptions>().Bind(config.GetSection(SmsOptions.Section));
        services.AddSingleton<ISmsSender, LogSmsSender>();
        // SMSSouthAfrica (D14): Sms__Provider=SmsSouthAfrica plus its Sms__SmsSouthAfrica__* settings.
        services.AddOptions<SmsSouthAfricaOptions>().Bind(config.GetSection(SmsSouthAfricaOptions.Section));
        services.AddHttpClient(SmsSouthAfricaSender.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(20));
        services.AddSingleton<ISmsSender, SmsSouthAfricaSender>();
        services.AddSingleton<SmsGateway>();

        return services;
    }
}
