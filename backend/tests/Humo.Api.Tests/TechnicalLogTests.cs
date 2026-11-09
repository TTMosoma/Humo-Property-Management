using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Api.Platform;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Xunit;

namespace Humo.Api.Tests;

public sealed class TechnicalLogTests(HumoApiFactory api) : IClassFixture<HumoApiFactory>
{
    private static string Today => DateTime.Now.ToString("yyyy-MM-dd");

    private sealed class Kept : ILogEventSink
    {
        public LogEvent? Last { get; private set; }
        public void Emit(LogEvent logEvent) => Last = logEvent;
    }

    private static LogEvent Written(Action<ILogger> write)
    {
        var kept = new Kept();
        using var logger = new LoggerConfiguration().Enrich.With<RemoveSecrets>().WriteTo.Sink(kept).CreateLogger();
        write(logger);
        return kept.Last!;
    }

    [Fact]
    public void Codes_and_tokens_never_reach_the_file()
    {
        var sms = Written(l => l.Warning("SMS to {To}: {Text}", "2782***67", "123456 is your Humo code"));
        Assert.DoesNotContain("123456", sms.RenderMessage());

        var link = Written(l => l.Information("{RequestPath}", "/api/documents/link/PcIAdqPDRABnTi7m4WuUQieEIOCEAmhCwg_vo7WcgbA"));
        Assert.DoesNotContain("PcIAdq", link.RenderMessage());

        var record = Written(l => l.Information("{RequestPath} {StatusCode}", "/api/jobs/01a1bae9-525d-7d9d-8a8b-6451c5bf3d59", 200));
        Assert.Contains("01a1bae9-525d-7d9d-8a8b-6451c5bf3d59", record.RenderMessage());
        Assert.Contains("200", record.RenderMessage());
    }

    [Fact]
    public async Task A_system_admin_finds_a_refusal_with_its_reason()
    {
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        var refused = await admin.PostAsJsonAsync("/api/platform/logs/query", new { date = "not-a-day" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);

        JsonElement found = default;
        await HumoApiFactory.Until(async () =>
        {
            var res = await admin.PostAsJsonAsync("/api/platform/logs/query", new { date = Today, level = "warning", search = "Choose a day" });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            var entries = (await res.Json()).GetProperty("entries");
            if (entries.GetArrayLength() == 0) return false;
            found = entries[0].Clone();
            return true;
        });

        Assert.Equal("Warning", found.GetProperty("level").GetString());
        Assert.Contains("date: Choose a day.", found.GetProperty("refusal").GetString());
        Assert.False(string.IsNullOrEmpty(found.GetProperty("traceId").GetString()));
    }

    [Theory]
    [InlineData("humo-support")]
    [InlineData("humo-executive")]
    public async Task Other_Humo_staff_cant_read_the_logs(string role)
    {
        var email = $"{role}-{Guid.NewGuid():N}@humo.co.za";
        await api.Person(email, role, null);
        var person = await api.SignedIn(email);

        var res = await person.PostAsJsonAsync("/api/platform/logs/query", new { date = Today });

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task Downloading_needs_a_passkey()
    {
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.PostAsJsonAsync("/api/platform/logs/query", new { date = "not-a-day" });

        await HumoApiFactory.Until(async () => (await (await admin.PostAsJsonAsync("/api/platform/logs/query", new { date = Today })).Json()).GetProperty("matched").GetInt32() > 0);
        var res = await admin.PostAsJsonAsync("/api/platform/logs/download", new { date = Today });

        Assert.Equal("step-up-required", await res.ProblemCode());
    }
}
