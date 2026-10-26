namespace Humo.Api.Startup;

/// <summary>
/// The go-live settings the API checks for itself (docs/18 D-4, D-17, D-18): in Production nothing may be switched
/// off or in test mode, or SMS, email and payments would look as if they work while nothing reaches anyone. The API
/// refuses to start and names each setting instead. A staging server runs as "Staging", where test modes are fine.
/// </summary>
public static class ProductionSettings
{
    public static List<string> Problems(IConfiguration config)
    {
        var problems = new List<string>();
        if (string.Equals(config["Mail:Provider"], "Log", StringComparison.OrdinalIgnoreCase))
            problems.Add("Mail:Provider is Log: emails are written to the log and none is sent (D-4).");
        var sms = config["Sms:Provider"] ?? "Log";
        if (string.Equals(sms, "Log", StringComparison.OrdinalIgnoreCase))
            problems.Add("Sms:Provider is Log: no SMS is sent. Set SMS_PROVIDER=SmsSouthAfrica (D-17).");
        else if (string.Equals(sms, "SmsSouthAfrica", StringComparison.OrdinalIgnoreCase))
        {
            if (config.GetValue("Sms:SmsSouthAfrica:TestMode", false))
                problems.Add("Sms:SmsSouthAfrica:TestMode is true: SMSSouthAfrica accepts messages but none reaches a phone. Set SMS_SOUTHAFRICA_TEST_MODE=false (D-17).");
            if (string.IsNullOrWhiteSpace(config["Sms:SmsSouthAfrica:ClientId"]) || string.IsNullOrWhiteSpace(config["Sms:SmsSouthAfrica:ApiSecret"]))
                problems.Add("Sms:SmsSouthAfrica:ClientId and ApiSecret must be set (D-17).");
        }
        // Payfast defaults to its sandbox (Payfast.cs): production must say otherwise.
        if (config.GetValue("Payments:Payfast:Sandbox", true))
            problems.Add("Payments:Payfast:Sandbox is true: owners' and agencies' card payments would go to Payfast's sandbox. Set PAYFAST_SANDBOX=false (D-18).");
        return problems;
    }

    public static void Check(IHostEnvironment env, IConfiguration config)
    {
        if (!env.IsProduction()) return;
        var problems = Problems(config);
        if (problems.Count > 0)
            throw new InvalidOperationException("Production settings aren't live yet, so the API won't start:" + Environment.NewLine + string.Join(Environment.NewLine, problems.Select(p => $"  - {p}")));
    }
}
