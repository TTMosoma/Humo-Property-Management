using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Humo.Api.Commands;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting.Compact;

namespace Humo.Api.Platform;

public sealed class TechnicalLogOptions
{
    public const string Section = "Logs";

    /// <summary>Where the daily files go. On disk, not in the database: logs matter most when the database is what's broken.</summary>
    public string Directory { get; set; } = "logs";

    /// <summary>Logs can hold personal data, so they aren't kept for ever. The audit log is what stays.</summary>
    public int RetainDays { get; set; } = 30;
}

/// <summary>Takes secrets out of an entry before it's written, so what's on disk is safe to read.</summary>
public sealed partial class RemoveSecrets : ILogEventEnricher
{
    private static readonly HashSet<string> Secret = new(StringComparer.OrdinalIgnoreCase)
        { "Password", "Secret", "ApiSecret", "Token", "Code", "Otp", "Text", "Body", "Credential", "Authorization", "Cookie" };

    /// <summary>A long opaque path segment is a signed link's token. A record's id (a GUID) stays.</summary>
    [GeneratedRegex("/(?![0-9a-fA-F]{8}-[0-9a-fA-F]{4}-)[A-Za-z0-9_-]{24,}")]
    private static partial Regex LongToken();

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        foreach (var (name, value) in logEvent.Properties.ToList())
        {
            if (Secret.Contains(name)) logEvent.AddOrUpdateProperty(propertyFactory.CreateProperty(name, "[removed]"));
            else if (name == "RequestPath" && value is ScalarValue { Value: string path })
                logEvent.AddOrUpdateProperty(propertyFactory.CreateProperty(name, LongToken().Replace(path, "/[removed]")));
        }
    }
}

public static class TechnicalLogging
{
    private const string FilePrefix = "humo-";

    public static string Folder(TechnicalLogOptions options, IHostEnvironment env) => Path.GetFullPath(options.Directory, env.ContentRootPath);

    public static void AddTechnicalLogging(this WebApplicationBuilder builder)
    {
        var section = builder.Configuration.GetSection(TechnicalLogOptions.Section);
        builder.Services.Configure<TechnicalLogOptions>(section);
        var options = section.Get<TechnicalLogOptions>() ?? new TechnicalLogOptions();
        var folder = Folder(options, builder.Environment);
        var testing = builder.Environment.IsEnvironment("Testing");
        builder.Services.AddSerilog(log =>
        {
            log.MinimumLevel.Information()
                .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
                .MinimumLevel.Override("Microsoft.EntityFrameworkCore", LogEventLevel.Warning)
                .Enrich.FromLogContext()
                .Enrich.With<RemoveSecrets>()
                .WriteTo.File(new RenderedCompactJsonFormatter(), Path.Combine(folder, $"{FilePrefix}.json"), rollingInterval: RollingInterval.Day,
                    retainedFileCountLimit: null, retainedFileTimeLimit: TimeSpan.FromDays(options.RetainDays), fileSizeLimitBytes: 200_000_000, rollOnFileSizeLimit: true,
                    flushToDiskInterval: TimeSpan.FromSeconds(1));
            // Still there when the API won't start, through `docker compose logs api`.
            if (!testing) log.WriteTo.Console();
        }, preserveStaticLogger: true);
    }

    /// <summary>One line per request, at the level its answer deserves: refusals are warnings and failures are errors.</summary>
    public static void UseTechnicalRequestLogging(this WebApplication app) =>
        app.UseSerilogRequestLogging(o =>
        {
            o.Logger = app.Services.GetRequiredService<Serilog.ILogger>(); // this host's logger: the static one writes nowhere
            o.MessageTemplate = "{RequestMethod:l} {RequestPath:l} answered {StatusCode} in {Elapsed:0} ms";
            o.GetLevel = (http, _, error) =>
                http.Request.Path.StartsWithSegments("/api/health") ? LogEventLevel.Debug
                : error is not null || http.Response.StatusCode >= 500 ? LogEventLevel.Error
                : http.Response.StatusCode >= 400 ? LogEventLevel.Warning
                : LogEventLevel.Information;
            o.EnrichDiagnosticContext = (context, http) =>
            {
                if (http.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value is { } user) context.Set("UserId", user);
            };
        });

    /// <summary>Puts the reason for a refusal on the request's log line. The audit log only records what changed, so this is the only trace of a refusal.</summary>
    public static void NoteRefusal(ProblemDetailsContext problem)
    {
        var details = problem.ProblemDetails;
        var fields = details.Extensions.TryGetValue("errors", out var errors) && errors is Dictionary<string, string> found ? found.Select(e => $"{e.Key}: {e.Value}").ToList() : [];
        var reason = string.Join("; ", new[] { details.Title }.Concat(fields).Where(x => !string.IsNullOrWhiteSpace(x)));
        if (reason.Length > 0) problem.HttpContext.RequestServices.GetService<IDiagnosticContext>()?.Set("Refusal", reason);
    }

    public static IEnumerable<string> FilesFor(string folder, DateOnly day) =>
        System.IO.Directory.Exists(folder) ? System.IO.Directory.GetFiles(folder, $"{FilePrefix}{day:yyyyMMdd}*.json").Order(StringComparer.Ordinal) : [];

    /// <summary>The file is open for writing: share it so reading doesn't get in the way.</summary>
    public static FileStream Open(string path) => new(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
}

public sealed record TechnicalLogQueryRequest(string? Date, string? Level, string? Search);
public sealed record TechnicalLogDownloadRequest(string? Date);
public sealed record TechnicalLogEntryDto(string At, string Level, string Message, string? Refusal, string? TraceId, string Raw);
public sealed record TechnicalLogResultDto(List<TechnicalLogEntryDto> Entries, int Matched);

/// <summary>
///   POST /platform/logs/query      one day's entries, newest first, by level and by text or reference
///   POST /platform/logs/download   that whole day's file (needs a passkey)
/// Humo's System Administrators only, never while impersonating. Both are commands so that reading the logs is in the audit log.
/// </summary>
public static partial class TechnicalLogEndpoints
{
    public const int MaxEntries = 500;
    private const string Permission = "Platform.Logs";

    /// <summary>The reference on an error ("00-{trace}-{span}-00"): the log holds its trace part.</summary>
    [GeneratedRegex("^00-([0-9a-fA-F]{32})-[0-9a-fA-F]{16}-[0-9a-fA-F]{2}$")]
    private static partial Regex Reference();

    private static readonly string[] Levels = ["Verbose", "Debug", "Information", "Warning", "Error", "Fatal"];

    public static void MapTechnicalLogs(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/platform/logs").RequireAuthorization();
        g.MapPost("/query", Query);
        g.MapPost("/download", Download);
    }

    private static DateOnly? Day(string? date) =>
        DateOnly.TryParseExact(date, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d) ? d : null;

    private static Dictionary<string, string> CheckDay(DateOnly? day) => day is null ? new() { ["date"] = "Choose a day." } : [];

    private static async Task<IResult> Query(TechnicalLogQueryRequest body, CurrentActor current, CommandRunner commands, IOptions<TechnicalLogOptions> options, IHostEnvironment env, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.Impersonation is not null) return Problems.Policy("forbidden", "Technical logs can’t be read while impersonating.");
        var day = Day(body.Date);
        return await commands.RunAsync(new CommandSpec($"Read the technical log for {body.Date}", Permission)
        {
            Resource = "Technical log",
            ResourceId = body.Date,
            Category = "security",
            Validate = () => CheckDay(day),
        }, async _ => Results.Ok(await ReadAsync(TechnicalLogging.Folder(options.Value, env), day!.Value, body.Level, body.Search, ct)), ct);
    }

    private static async Task<IResult> Download(TechnicalLogDownloadRequest body, CurrentActor current, CommandRunner commands, IOptions<TechnicalLogOptions> options, IHostEnvironment env, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.Impersonation is not null) return Problems.Policy("forbidden", "Technical logs can’t be read while impersonating.");
        var day = Day(body.Date);
        var files = day is { } d ? TechnicalLogging.FilesFor(TechnicalLogging.Folder(options.Value, env), d).ToList() : [];
        return await commands.RunAsync(new CommandSpec($"Downloaded the technical log for {body.Date}", Permission)
        {
            Resource = "Technical log",
            ResourceId = body.Date,
            Category = "security",
            StepUp = true,
            Validate = () => day is null ? CheckDay(day) : files.Count == 0 ? new() { ["date"] = "There’s no log for that day." } : [],
        }, async _ =>
        {
            using var all = new MemoryStream();
            foreach (var file in files)
            {
                await using var stream = TechnicalLogging.Open(file);
                await stream.CopyToAsync(all, ct);
            }
            return Results.File(all.ToArray(), "application/json", $"humo-log-{body.Date}.json");
        }, ct);
    }

    private static async Task<TechnicalLogResultDto> ReadAsync(string folder, DateOnly day, string? level, string? search, CancellationToken ct)
    {
        var least = level switch { "error" => 4, "warning" => 3, _ => 0 };
        var text = search?.Trim() ?? "";
        if (Reference().Match(text) is { Success: true } reference) text = reference.Groups[1].Value;

        var newest = new Queue<TechnicalLogEntryDto>(MaxEntries);
        var matched = 0;
        foreach (var file in TechnicalLogging.FilesFor(folder, day))
        {
            await using var stream = TechnicalLogging.Open(file);
            using var reader = new StreamReader(stream, Encoding.UTF8);
            while (await reader.ReadLineAsync(ct) is { } line)
            {
                if (text.Length > 0 && !line.Contains(text, StringComparison.OrdinalIgnoreCase)) continue;
                if (Parse(line) is not { } entry || Array.IndexOf(Levels, entry.Level) < least) continue;
                matched++;
                if (newest.Count == MaxEntries) newest.Dequeue();
                newest.Enqueue(entry);
            }
        }
        return new TechnicalLogResultDto([.. newest.Reverse()], matched);
    }

    private static TechnicalLogEntryDto? Parse(string line)
    {
        try
        {
            using var json = JsonDocument.Parse(line);
            var root = json.RootElement;
            string? Text(string name) => root.TryGetProperty(name, out var v) ? v.GetString() : null;
            // The file format leaves the level out when it's Information.
            return new TechnicalLogEntryDto(Text("@t") ?? "", Text("@l") ?? "Information", Text("@m") ?? "", Text("Refusal"), Text("@tr"), line);
        }
        catch (JsonException)
        {
            return null; // a line still being written
        }
    }
}
