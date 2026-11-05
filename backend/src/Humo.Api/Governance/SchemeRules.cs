using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Commercial;
using Humo.Api.Files;
using Humo.Api.Finance;
using Humo.Api.Messaging;
using Humo.Api.Platform;
using Humo.Api.Portfolio;
using Humo.Api.Work;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Documents;
using Humo.Infrastructure.Files;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Governance;

// The shapes match the app's rules model (domain/models/rules.ts).
public sealed record RuleVersion(string Text, string AdoptedAt, string ResolutionRef, string? ResolutionId);
public sealed record RuleRepeal(string At, string ResolutionRef);
public sealed record SchemeRuleDto(string Id, int Version, string SchemeId, string Number, string Title, string Category, string Status, IReadOnlyList<RuleVersion> Versions, RuleRepeal? Repealed);
public sealed record RulesSource(string DocumentId, string FileName, long SizeBytes, string AdoptedOn, string ResolutionRef, string UploadedAt, string UploadedBy, bool Shared);
public sealed record RuleShare(string At, string By, string DocumentId, string RulesVersion);
public sealed record RuleBookDto(string SchemeId, IReadOnlyList<RulesSource>? Sources, RuleShare? Shared, bool ChangedSinceShared);
public sealed record RulesViewDto(SchemeDto Scheme, IReadOnlyList<SchemeRuleDto> Rules, RuleBookDto Book, Dictionary<string, int> OpenBreaches);
public sealed record BreachEvent(string At, string By, string Kind, string Text, string? SentId = null);
public sealed record BreachDto(string Id, int Version, string Ref, string SchemeId, string RuleId, string UnitId, string PersonId, string Description, string OccurredAt, string ReportedBy,
    string Status, string? RemedyBy, IReadOnlyList<BreachEvent> Events, string AssigneeId);
public sealed record BreachViewDto(BreachDto Breach, SchemeDto Scheme, SchemeRuleDto Rule, UnitDto Unit, PersonDto Person, string PersonRole, string AssigneeName, int Repeats);

public sealed record RuleActionRequest(string? Type, string? RuleId, string? Number, string? Title, string? Category, string? Text, string? ResolutionId, string? ResolutionRef, string? AdoptedOn);
public sealed record NewBreachRequest(string? SchemeId, string? RuleId, string? UnitId, string? Against, string? Description, string? OccurredAt);
public sealed record BreachAction(string? Type, bool? Final, int? RemedyDays, string? Message, string? Channel, string? Text, string? Note);
public sealed record BreachActionRequest(BreachAction? Action, int? ExpectedVersion);

/// <summary>What a scheme's rule book holds beyond its rules: the registered PDFs, and what owners were last given.</summary>
public sealed class RuleBookState
{
    public List<RulesSource> Sources { get; set; } = [];
    public RuleShare? Shared { get; set; }
}

/// <summary>
/// Governance › Scheme rules and the breach log on the API (doc 15 §6, D29). Rules change only by resolution of the owners.
/// Reading needs Governance.View; changing rules needs Meetings.Manage; the breach log needs Rules.Enforce; all need
/// the scheme-rules feature. Humo PM doesn't levy fines: an unresolved breach goes to the trustees, who decide what's next.
/// </summary>
public static class SchemeRules
{
    private const string Feature = "scheme-rules";
    private static readonly string[] Categories = ["pets", "parking", "noise", "alterations", "refuse", "common-property", "letting", "safety", "other"];
    private static readonly TimeSpan Sa = TimeSpan.FromHours(2);
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public static void MapSchemeRules(this IEndpointRouteBuilder api)
    {
        var r = api.MapGroup("/rules").RequireAuthorization();
        r.MapGet("/{schemeId:guid}", Get);
        r.MapPost("/{schemeId:guid}/actions", ActOnRules);
        r.MapPost("/{schemeId:guid}/upload", Upload);
        var b = api.MapGroup("/breaches").RequireAuthorization();
        b.MapGet("", Breaches);
        b.MapGet("/{id:guid}", GetBreach);
        b.MapPost("", LogBreach);
        b.MapPost("/{id:guid}/actions", ActOnBreach);
    }

    // ---------------------------------------------------------------- Reads

    /// <summary>The plan's feature applies to reading too: feature flags only hide screens (CLAUDE.md).</summary>
    private static async Task<IResult?> CannotReadAsync(Actor actor, CommercialRecords commercial, CancellationToken ct)
    {
        if (!actor.Can("Governance.View") || actor.OrganisationId is not { } org) return Problems.Policy("forbidden", "Role does not have this permission");
        return await commercial.EntitledAsync(org, Feature, ct) ? null : Problems.Policy("not-entitled", "Not included in the agency’s plan");
    }

    private static async Task<IResult> Get(Guid schemeId, CurrentActor current, CommercialRecords commercial, PortfolioReads reads, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await CannotReadAsync(actor, commercial, ct) is { } refused) return refused;
        var scheme = (await reads.ReadableSchemes(actor, [schemeId.ToString()], ct)).FirstOrDefault();
        if (scheme is null) return Problems.NotFound();
        var rules = Sorted((await db.SchemeRules.AsNoTracking().Where(x => x.SchemeId == schemeId).ToListAsync(ct)).Select(ToDto));
        var open = (await db.Breaches.AsNoTracking().Where(x => x.SchemeId == schemeId && x.Status != "resolved").Select(x => x.RuleId).ToListAsync(ct))
            .GroupBy(x => x).ToDictionary(g => g.Key.ToString(), g => g.Count());
        var dto = (await SchemeEndpoints.ToDtos([scheme], db, ct))[0];
        return Results.Ok(new RulesViewDto(dto, rules, Book(schemeId, await StateAsync(db, schemeId, ct), rules), open));
    }

    private static async Task<IResult> Breaches(string[]? schemeIds, CurrentActor current, CommercialRecords commercial, PortfolioReads reads, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await CannotReadAsync(actor, commercial, ct) is { } refused) return refused;
        var schemes = (await reads.ReadableSchemes(actor, schemeIds, ct)).Select(s => s.Id).ToList();
        return Results.Ok(await ViewsAsync(await db.Breaches.AsNoTracking().Where(x => schemes.Contains(x.SchemeId)).ToListAsync(ct), reads, db, ct));
    }

    private static async Task<IResult> GetBreach(Guid id, CurrentActor current, CommercialRecords commercial, PortfolioReads reads, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await CannotReadAsync(actor, commercial, ct) is { } refused) return refused;
        var row = await db.Breaches.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (row is null || (await reads.ReadableSchemes(actor, [row.SchemeId.ToString()], ct)).Count == 0) return Problems.NotFound();
        var view = (await ViewsAsync([row], reads, db, ct)).FirstOrDefault();
        return view is null ? Problems.NotFound() : Results.Ok(view);
    }

    private static async Task<List<BreachViewDto>> ViewsAsync(List<BreachRow> rows, PortfolioReads reads, HumoDbContext db, CancellationToken ct)
    {
        var schemeIds = rows.Select(x => x.SchemeId).Distinct().ToList();
        var schemes = (await SchemeEndpoints.ToDtos(await db.Schemes.AsNoTracking().Where(s => schemeIds.Contains(s.Id)).ToListAsync(ct), db, ct)).ToDictionary(s => s.Id);
        var rules = (await db.SchemeRules.AsNoTracking().Where(x => schemeIds.Contains(x.SchemeId)).ToListAsync(ct)).ToDictionary(x => x.Id);
        var unitIds = rows.Select(x => x.UnitId).Distinct().ToList();
        var units = await db.Units.AsNoTracking().Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        var personIds = rows.Select(x => x.PersonId).Distinct().ToList();
        var people = await db.People.AsNoTracking().Where(p => personIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var tenants = (await db.Relationships.AsNoTracking().Where(r => r.Type == "tenant" && r.UnitId != null && unitIds.Contains(r.UnitId.Value)).ToListAsync(ct))
            .Where(reads.IsCurrent).Select(r => (r.UnitId!.Value, r.PersonId)).ToHashSet();
        var assigneeIds = rows.Select(x => Guid.TryParse(x.AssigneeId, out var g) ? g : Guid.Empty).Distinct().ToList();
        var names = await db.Users.AsNoTracking().Where(u => assigneeIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id.ToString(), u => u.Name, ct);
        var views = new List<BreachViewDto>();
        foreach (var b in rows)
        {
            if (!rules.TryGetValue(b.RuleId, out var rule) || !units.TryGetValue(b.UnitId, out var unit) || !people.TryGetValue(b.PersonId, out var person)) continue;
            var repeats = await db.Breaches.AsNoTracking().CountAsync(x => x.Id != b.Id && x.RuleId == b.RuleId && x.UnitId == b.UnitId && x.OccurredAt < b.OccurredAt, ct);
            views.Add(new BreachViewDto(ToDto(b), schemes[b.SchemeId.ToString()], ToDto(rule), PortfolioReads.ToDto(unit), PortfolioReads.ToDto(person),
                tenants.Contains((b.UnitId, b.PersonId)) ? "tenant" : "owner", names.GetValueOrDefault(b.AssigneeId, "Agency queue"), repeats));
        }
        return views;
    }

    private static SchemeRuleDto ToDto(SchemeRuleRow r) => new(r.Id.ToString(), r.Version, r.SchemeId.ToString(), r.Number, r.Title, r.Category, r.Status, VersionsOf(r),
        r.RepealedAt is { } at ? new RuleRepeal(Date(at), r.RepealedBy ?? "") : null);

    private static BreachDto ToDto(BreachRow b) => new(b.Id.ToString(), b.Version, b.Ref, b.SchemeId.ToString(), b.RuleId.ToString(), b.UnitId.ToString(), b.PersonId.ToString(), b.Description,
        Date(b.OccurredAt), b.ReportedBy, b.Status, b.RemedyBy is { } d ? Date(d) : null, EventsOf(b), b.AssigneeId);

    private static List<RuleVersion> VersionsOf(SchemeRuleRow r) => JsonSerializer.Deserialize<List<RuleVersion>>(r.Versions, Json.Options) ?? [];
    private static List<BreachEvent> EventsOf(BreachRow b) => JsonSerializer.Deserialize<List<BreachEvent>>(b.Events, Json.Options) ?? [];
    private static string Date(DateOnly d) => d.ToString("yyyy-MM-dd", Invariant);

    /// <summary>"4.10" comes after "4.2".</summary>
    private static List<SchemeRuleDto> Sorted(IEnumerable<SchemeRuleDto> rules) =>
        [.. rules.OrderBy(r => string.Join('.', r.Number.Split('.').Select(p => p.PadLeft(6, '0'))), StringComparer.Ordinal)];

    private static async Task<RuleBookState> StateAsync(HumoDbContext db, Guid schemeId, CancellationToken ct) =>
        await db.RuleBooks.AsNoTracking().Where(x => x.SchemeId == schemeId).Select(x => x.Json).FirstOrDefaultAsync(ct) is { } json
            ? JsonSerializer.Deserialize<RuleBookState>(json, Json.Options)!
            : new RuleBookState();

    /// <summary>When owners have the registered rules PDF, the register is the agency's working copy: no "share again" nudge.</summary>
    private static RuleBookDto Book(Guid schemeId, RuleBookState s, IReadOnlyList<SchemeRuleDto> rules)
    {
        var since = s.Shared?.At[..10] ?? "";
        var changed = rules.Any(r => string.CompareOrdinal(r.Versions[0].AdoptedAt, since) > 0 || string.CompareOrdinal(r.Repealed?.At ?? "", since) > 0);
        var sharedIsPdf = s.Shared is { } sh && s.Sources.FirstOrDefault()?.DocumentId == sh.DocumentId;
        return new RuleBookDto(schemeId.ToString(), s.Sources.Count > 0 ? s.Sources : null, s.Shared, s.Shared is not null && changed && !sharedIsPdf);
    }

    private static async Task SaveStateAsync(HumoDbContext db, Guid orgId, Guid schemeId, RuleBookState state, CancellationToken ct)
    {
        var row = await db.RuleBooks.FirstOrDefaultAsync(x => x.SchemeId == schemeId, ct);
        if (row is null) db.RuleBooks.Add(row = new RuleBookRow { SchemeId = schemeId, OrganisationId = orgId });
        row.Json = JsonSerializer.Serialize(state, Json.Options);
    }

    // ---------------------------------------------------------------- The rules register

    private static async Task<IResult> ActOnRules(Guid schemeId, RuleActionRequest a, CurrentActor current, CommandRunner commands, PortfolioReads reads, HumoDbContext db, IPdfRenderer renderer,
        IFileStore store, PackageLimits limits, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var scheme = (await reads.ReadableSchemes(actor, [schemeId.ToString()], ct)).FirstOrDefault();
        if (scheme is null) return Problems.NotFound();
        if (a.Type is not ("add" or "amend" or "repeal" or "share")) return Problems.Validation(new() { ["type"] = "Add, amend, repeal or share." });

        var all = await db.SchemeRules.Where(x => x.SchemeId == schemeId).ToListAsync(ct);
        var target = Guid.TryParse(a.RuleId, out var ruleId) ? all.FirstOrDefault(x => x.Id == ruleId) : null;
        // A resolution cited from the register has to be a passed one of this scheme.
        var cited = Guid.TryParse(a.ResolutionId, out var resolutionId)
            ? await db.Resolutions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == resolutionId && x.SchemeId == schemeId && x.Outcome == "passed", ct)
            : null;
        var what = a.Type switch
        {
            "add" => $"Added rule {a.Number?.Trim()} ({a.Title?.Trim()})",
            "amend" => $"Amended rule {target?.Number}",
            "repeal" => $"Repealed rule {target?.Number}",
            _ => "Shared the rule book with owners",
        };
        var openOnTarget = target is not null && await db.Breaches.AnyAsync(x => x.RuleId == target.Id && x.Status != "resolved", ct);

        return await commands.RunAsync(new CommandSpec($"{what} · {scheme.Name}", "Meetings.Manage")
        {
            Resource = "Scheme rules",
            ResourceId = (target?.Id ?? schemeId).ToString(),
            SchemeId = schemeId,
            Feature = Feature,
            Validate = () => CheckRules(a, all, target, cited, openOnTarget, reads.Today),
        }, async writer =>
        {
            var (adoptedAt, reference, citedId) = Citation(a, cited);
            switch (a.Type)
            {
                case "add":
                    var id = Guid.CreateVersion7();
                    db.SchemeRules.Add(new SchemeRuleRow
                    {
                        Id = id, OrganisationId = scheme.OrganisationId, SchemeId = schemeId, Number = a.Number!.Trim(), Title = a.Title!.Trim(), Category = a.Category!, Status = "in-force",
                        // No resolution: the rule is being captured from the registered rules (onboarding).
                        Versions = JsonSerializer.Serialize(new[] { new RuleVersion(a.Text!.Trim(), adoptedAt ?? Date(reads.Today), reference ?? $"Captured from the registered rules by {writer.Human.Name}", citedId) }, Json.Options),
                    });
                    return Results.Ok(new { id = id.ToString() });
                case "amend":
                    target!.Versions = JsonSerializer.Serialize(new[] { new RuleVersion(a.Text!.Trim(), adoptedAt!, reference!, citedId) }.Concat(VersionsOf(target)), Json.Options);
                    target.Version++;
                    return Results.NoContent();
                case "repeal":
                    target!.Status = "repealed";
                    target.RepealedAt = DateOnly.ParseExact(adoptedAt!, "yyyy-MM-dd", Invariant);
                    target.RepealedBy = reference;
                    target.Version++;
                    return Results.NoContent();
                default:
                    return Results.Ok(new { id = await ShareAsync(scheme, all, writer, db, renderer, store, limits, clock, ct) });
            }
        }, ct);
    }

    /// <summary>What a change cites: the register's resolution, or one typed from the minutes (D29). Nulls: nothing cited.</summary>
    private static (string? AdoptedAt, string? Reference, string? ResolutionId) Citation(RuleActionRequest a, ResolutionRow? cited)
    {
        if (cited is not null)
        {
            var r = Governance.Read(cited);
            var at = DateTimeOffset.Parse(r.DecidedAt ?? r.ProposedAt, Invariant).ToOffset(Sa);
            return (at.ToString("yyyy-MM-dd", Invariant), r.Ref, r.Id);
        }
        return string.IsNullOrWhiteSpace(a.ResolutionRef) ? (null, null, null) : (a.AdoptedOn, a.ResolutionRef.Trim(), null);
    }

    private static Dictionary<string, string> CheckRules(RuleActionRequest a, List<SchemeRuleRow> all, SchemeRuleRow? target, ResolutionRow? cited, bool openOnTarget, DateOnly today)
    {
        var e = new Dictionary<string, string>();
        void NeedsResolution()
        {
            if (!string.IsNullOrWhiteSpace(a.ResolutionId) || a.ResolutionRef is null)
            {
                if (cited is null) e["resolutionId"] = "Rules change only by resolution of the owners: choose the passed resolution.";
                return;
            }
            if (a.ResolutionRef.Trim().Length < 3) e["resolutionRef"] = "Rules change only by resolution of the owners: give the resolution as in the minutes.";
            if (PeopleEndpoints.ParseDate(a.AdoptedOn) is not { } on || on > today) e["adoptedOn"] = "When was it passed? Not in the future.";
        }
        switch (a.Type)
        {
            case "add":
                var number = (a.Number ?? "").Trim();
                if (!System.Text.RegularExpressions.Regex.IsMatch(number, @"^\d+(\.\d+)*$")) e["number"] = "A number like 4 or 4.3.";
                else if (all.Any(r => r.Status == "in-force" && r.Number == number)) e["number"] = $"Rule {number} already exists: amend it instead.";
                if ((a.Title ?? "").Trim().Length < 3) e["title"] = "Give the rule a short title.";
                if (!Categories.Contains(a.Category)) e["category"] = "Choose a category.";
                if ((a.Text ?? "").Trim().Length < 20) e["text"] = "Write the rule as adopted.";
                if (!string.IsNullOrWhiteSpace(a.ResolutionId) || !string.IsNullOrWhiteSpace(a.ResolutionRef)) NeedsResolution();
                break;
            case "amend":
                if (target is not { Status: "in-force" }) return new() { ["ruleId"] = "That rule isn’t in force." };
                if ((a.Text ?? "").Trim() == VersionsOf(target)[0].Text) e["text"] = "The wording hasn’t changed.";
                else if ((a.Text ?? "").Trim().Length < 20) e["text"] = "Write the rule as amended.";
                NeedsResolution();
                break;
            case "repeal":
                if (target is not { Status: "in-force" }) return new() { ["ruleId"] = "That rule isn’t in force." };
                if (openOnTarget) e["resolutionId"] = "Resolve the open breaches of this rule first.";
                else NeedsResolution();
                break;
            default:
                if (!all.Any(r => r.Status == "in-force")) e["schemeId"] = "There are no rules to share yet.";
                break;
        }
        return e;
    }

    /// <summary>Publishes the rule book as a PDF in Documents (owners and residents see it), replacing what was shared before.</summary>
    private static async Task<string> ShareAsync(Scheme scheme, List<SchemeRuleRow> all, Actor writer, HumoDbContext db, IPdfRenderer renderer, IFileStore store, PackageLimits limits,
        TimeProvider clock, CancellationToken ct)
    {
        var rules = Sorted(all.Where(r => r.Status == "in-force").Select(ToDto));
        var latest = rules.Select(r => r.Versions[0].AdoptedAt).Max(StringComparer.Ordinal)!;
        byte[] pdf;
        try
        {
            pdf = await renderer.RenderHtmlAsync(RuleBookHtml(scheme.Name, rules, latest), ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            throw new CommandRefused("render-failed", "The rule book couldn’t be turned into a PDF just now, so nothing was shared. Try again shortly.");
        }
        if (await limits.RefuseNewFileAsync(scheme.OrganisationId, pdf.Length, ct) is { } full) throw new CommandRefused("storage-full", full);

        var now = clock.GetUtcNow();
        var fileName = $"{scheme.Code.ToLowerInvariant()}-conduct-rules-{latest}.pdf";
        var documentId = await AddDocumentAsync(scheme, pdf, fileName, $"Conduct rules (as at {Long(latest)})", "owners", $"{rules.Count} rules in force. Shared from Governance › Scheme rules.", writer, db, store, now, ct);
        foreach (var d in await db.LibraryDocuments.Where(x => x.SchemeId == scheme.Id && x.ArchivedAt == null && x.Category == "rules" && x.RecordKind == "scheme").ToListAsync(ct))
            Archive(d, writer, "Replaced by the rule book shared from Scheme rules", now);
        var state = await StateAsync(db, scheme.Id, ct);
        state.Shared = new RuleShare(now.ToString("O"), writer.Human.Name, documentId.ToString(), latest);
        await SaveStateAsync(db, scheme.OrganisationId, scheme.Id, state, ct);
        return documentId.ToString();
    }

    private static string Long(string date) => DateOnly.ParseExact(date, "yyyy-MM-dd", Invariant).ToString("d MMMM yyyy", Invariant);

    private static async Task<Guid> AddDocumentAsync(Scheme scheme, byte[] pdf, string fileName, string title, string visibility, string notes, Actor writer, HumoDbContext db, IFileStore store, DateTimeOffset now,
        CancellationToken ct)
    {
        var key = await store.SaveAsync(pdf, ct);
        var fileId = Guid.CreateVersion7();
        db.UploadedFiles.Add(new UploadedFile
        {
            Id = fileId, OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, Name = fileName, ContentType = "application/pdf", SizeBytes = pdf.Length,
            Sha256 = Convert.ToHexStringLower(SHA256.HashData(pdf)), StorageKey = key, ScanResult = "clean", UploadedBy = writer.Human.Name, UploadedAt = now,
        });
        var id = Guid.CreateVersion7();
        db.LibraryDocuments.Add(new LibraryDocument
        {
            Id = id, OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, FileId = fileId, RecordKind = "scheme", Title = title, Category = "rules", Visibility = visibility,
            Notes = notes, Version = 1, UploadedBy = writer.Human.Name, UploadedAt = now,
        });
        return id;
    }

    private static void Archive(LibraryDocument d, Actor writer, string reason, DateTimeOffset now)
    {
        d.ArchivedAt = now;
        d.ArchivedBy = writer.Human.Name;
        d.ArchiveReason = reason;
        d.Version++;
    }

    /// <summary>
    /// The registered rules as a PDF: stored in Documents and kept with its history. Shared with owners, it replaces the copy they had;
    /// staff-only, it leaves their copy in place.
    /// </summary>
    private static async Task<IResult> Upload(Guid schemeId, HttpRequest request, CurrentActor current, CommandRunner commands, PortfolioReads reads, HumoDbContext db, IFileStore store, IFileScanner scanner,
        IOptions<FilesOptions> options, PackageLimits limits, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var scheme = (await reads.ReadableSchemes(actor, [schemeId.ToString()], ct)).FirstOrDefault();
        if (scheme is null) return Problems.NotFound();
        var form = await request.ReadFormAsync(ct);
        var adoptedOn = PeopleEndpoints.ParseDate(form["adoptedOn"].ToString());
        var reference = form["resolutionRef"].ToString().Trim();
        var share = form["shareWithOwners"].ToString() == "true";
        var errors = new Dictionary<string, string>();
        if (adoptedOn is not { } on || on > reads.Today) errors["adoptedOn"] = "When did these rules take effect? Not in the future.";
        if (reference.Length < 3) errors["resolutionRef"] = "How were they adopted? E.g. “Registered with the CSOS” or the AGM resolution.";
        if (errors.Count > 0) return Problems.Validation(errors);

        var (accepted, refusal) = await PdfIntake.CheckAsync(form.Files.FirstOrDefault(), options.Value.MaxBytes, scanner, ct);
        if (refusal is not null) return refusal;
        if (await limits.RefuseNewFileAsync(scheme.OrganisationId, accepted!.Bytes.Length, ct) is { } full) return Problems.Validation(new() { ["file"] = full });
        var date = Date(adoptedOn!.Value);

        return await commands.RunAsync(new CommandSpec($"Uploaded the registered rules PDF “{accepted.Name}” (in force from {date}; {reference}) · {scheme.Name}", "Meetings.Manage")
        {
            Resource = "Scheme rules",
            ResourceId = schemeId.ToString(),
            SchemeId = schemeId,
            Feature = Feature,
        }, async writer =>
        {
            var now = clock.GetUtcNow();
            var state = await StateAsync(db, schemeId, ct);
            var earlier = state.Sources.Select(s => s.DocumentId).ToHashSet();
            if (state.Shared is { } sh) { if (share) earlier.Add(sh.DocumentId); else earlier.Remove(sh.DocumentId); }
            var documentId = await AddDocumentAsync(scheme, accepted.Bytes, accepted.Name, $"Registered conduct rules (in force from {Long(date)})", share ? "owners" : "staff",
                $"{scheme.Name}: {reference}. Uploaded in Governance › Scheme rules.", writer, db, store, now, ct);
            var ids = earlier.Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).ToList();
            foreach (var d in await db.LibraryDocuments.Where(x => ids.Contains(x.Id) && x.ArchivedAt == null).ToListAsync(ct))
                Archive(d, writer, "Replaced by the registered rules PDF uploaded in Scheme rules", now);
            state.Sources.Insert(0, new RulesSource(documentId.ToString(), accepted.Name, accepted.Bytes.Length, date, reference, now.ToString("O"), writer.Human.Name, share));
            if (share) state.Shared = new RuleShare(now.ToString("O"), writer.Human.Name, documentId.ToString(), date);
            await SaveStateAsync(db, scheme.OrganisationId, schemeId, state, ct);
            return Results.Ok(new { id = documentId.ToString() });
        }, ct);
    }

    private static string RuleBookHtml(string scheme, IReadOnlyList<SchemeRuleDto> rules, string asAt)
    {
        static string Esc(string s) => WebUtility.HtmlEncode(s);
        var html = new StringBuilder();
        html.Append("<!doctype html><html><head><meta charset=\"utf-8\"><title>").Append(Esc(scheme)).Append(" conduct rules</title>")
            .Append("<style>@page{size:A4;margin:20mm}body{font:11pt/1.5 Arial,sans-serif;color:#1d1d1f}h1{margin:0 0 4px}.m{color:#666;font-size:9pt}section{border-top:1px solid #ddd;padding-top:6px;break-inside:avoid}h3{margin:6px 0 2px}p{margin:4px 0}</style></head><body data-print-ready>")
            .Append("<h1>").Append(Esc(scheme)).Append("</h1><p class=\"m\">Conduct rules as at ").Append(Esc(Long(asAt))).Append(". ").Append(rules.Count).Append(" rules in force.</p>");
        foreach (var r in rules)
            html.Append("<section><h3>").Append(Esc(r.Number)).Append(' ').Append(Esc(r.Title)).Append("</h3><p>").Append(Esc(r.Versions[0].Text)).Append("</p><p class=\"m\">Adopted ")
                .Append(Esc(Long(r.Versions[0].AdoptedAt))).Append(" · ").Append(Esc(r.Versions[0].ResolutionRef)).Append("</p></section>");
        return html.Append("</body></html>").ToString();
    }

    // ---------------------------------------------------------------- The breach log

    private static async Task<IResult> LogBreach(NewBreachRequest body, CurrentActor current, CommandRunner commands, PortfolioReads reads, HumoDbContext db, StaffCovers covers, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var scheme = Guid.TryParse(body.SchemeId, out var schemeId) ? (await reads.ReadableSchemes(actor, [schemeId.ToString()], ct)).FirstOrDefault() : null;
        if (scheme is null) return Problems.NotFound();
        var rule = Guid.TryParse(body.RuleId, out var ruleId) ? await db.SchemeRules.AsNoTracking().FirstOrDefaultAsync(x => x.Id == ruleId && x.SchemeId == schemeId, ct) : null;
        var unit = Guid.TryParse(body.UnitId, out var unitId) ? await db.Units.AsNoTracking().FirstOrDefaultAsync(x => x.Id == unitId && x.SchemeId == schemeId, ct) : null;
        var roles = unit is null ? [] : (await db.Relationships.AsNoTracking().Where(r => r.UnitId == unit.Id && (r.Type == "owner" || r.Type == "tenant")).ToListAsync(ct)).Where(reads.IsCurrent).ToList();
        var person = roles.Where(r => r.Type == (body.Against == "tenant" ? "tenant" : "owner")).OrderBy(r => r.Since).FirstOrDefault();

        return await commands.RunAsync(new CommandSpec($"Logged a rule breach at Unit {unit?.Number ?? "?"}, {scheme.Name}", "Rules.Enforce")
        {
            Resource = "Rule breach",
            SchemeId = schemeId,
            Feature = Feature,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (rule is not { Status: "in-force" }) e["ruleId"] = "Choose a rule in force at this scheme.";
                if (unit is null) e["unitId"] = "Choose a unit in this scheme.";
                else if (person is null) e["against"] = body.Against == "tenant" ? "This unit has no tenant on record: the letter goes to the owner." : "This unit has no owner on record.";
                if ((body.Description ?? "").Trim().Length < 10) e["description"] = "Describe what happened: when, where, what was seen or heard.";
                if (PeopleEndpoints.ParseDate(body.OccurredAt) is not { } on || on > reads.Today) e["occurredAt"] = "A date on or before today.";
                return e;
            },
        }, async writer =>
        {
            var number = Math.Max((await db.Breaches.Where(x => x.OrganisationId == scheme.OrganisationId).Select(x => (int?)x.Number).MaxAsync(ct)) ?? 1000, 1000) + 1;
            var description = body.Description!.Trim();
            var row = new BreachRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = scheme.OrganisationId, SchemeId = schemeId, Number = number, Ref = $"BR-{number}", RuleId = rule!.Id, UnitId = unit!.Id, PersonId = person!.PersonId,
                Description = description, OccurredAt = PeopleEndpoints.ParseDate(body.OccurredAt)!.Value, ReportedBy = writer.Human.Name, Status = "open",
                Events = JsonSerializer.Serialize(new[] { new BreachEvent(clock.GetUtcNow().ToString("O"), writer.Human.Name, "reported", $"Reported: {description}") }, Json.Options),
                AssigneeId = await AssigneeAsync(scheme, writer, db, covers, ct),
            };
            db.Breaches.Add(row);
            return Results.Created($"/api/breaches/{row.Id}", new { id = row.Id.ToString() });
        }, ct);
    }

    /// <summary>The scheme's portfolio manager, or whoever covers them while they're away; with no manager, the person logging it.</summary>
    private static async Task<string> AssigneeAsync(Scheme scheme, Actor writer, HumoDbContext db, StaffCovers covers, CancellationToken ct)
    {
        var manager = (await SchemeEndpoints.ToDtos([scheme], db, ct))[0].PortfolioManager?.IdentityId ?? writer.Human.Id.ToString();
        var cover = (await covers.OpenCoversAsync(scheme.OrganisationId, ct)).FirstOrDefault(c => covers.Active(c) && c.StaffId.ToString() == manager);
        return cover?.CoverId.ToString() ?? manager;
    }

    private static async Task<IResult> ActOnBreach(Guid id, BreachActionRequest body, CurrentActor current, CommandRunner commands, PortfolioReads reads, HumoDbContext db, Communications comms, Notices notices,
        TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (body.Action is not { } a) return Problems.Validation(new() { ["type"] = "What should happen?" });
        var b = await db.Breaches.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (b is null || (await reads.ReadableSchemes(actor, [b.SchemeId.ToString()], ct)).Count == 0) return Problems.NotFound();
        var person = await db.People.AsNoTracking().FirstAsync(p => p.Id == b.PersonId, ct);
        var what = a.Type switch
        {
            "warn" => a.Final == true ? "Sent a final warning" : "Sent a warning",
            "note" => "Added a note",
            "refer" => "Referred to the trustees",
            "resolve" => "Resolved",
            "reopen" => "Reopened",
            _ => "Acted on",
        };

        return await commands.RunAsync(new CommandSpec($"{what} · breach {b.Ref}", "Rules.Enforce")
        {
            Resource = "Rule breach",
            ResourceId = b.Id.ToString(),
            SchemeId = b.SchemeId,
            Feature = Feature,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = b.Version,
            Validate = () => CheckBreach(b, a, person),
        }, async writer =>
        {
            var now = clock.GetUtcNow();
            var at = now.ToString("O");
            var by = writer.Human.Name;
            var events = EventsOf(b);
            var rule = await db.SchemeRules.AsNoTracking().FirstAsync(x => x.Id == b.RuleId, ct);
            var unit = await db.Units.AsNoTracking().FirstAsync(x => x.Id == b.UnitId, ct);
            var route = $"/governance/rules/breaches/{b.Id}";
            switch (a.Type)
            {
                case "warn":
                    var final = a.Final == true;
                    var remedyBy = reads.Today.AddDays(a.RemedyDays!.Value);
                    var dateText = remedyBy.ToString("d MMMM yyyy", Invariant);
                    var label = final ? "Final warning" : "Warning";
                    string? sentId = null;
                    // Post isn't a Humo PM channel: the letter is printed and posted, and Humo PM records that it was.
                    if (a.Channel == "email")
                    {
                        var (message, sendNow) = await comms.SendToAsync("letter", b.SchemeId, new Addressee(person, unit, null), "email", $"{label}: rule {rule.Number} ({rule.Title}), Unit {unit.Number}",
                            Letter(a.Message!, dateText), $"{person.DisplayName} · Unit {unit.Number}", by, new SentSourceDto(b.Ref, route), ct);
                        sentId = message.Id.ToString();
                        commands.AfterCommit(() => comms.DeliverAsync(sendNow, ct));
                    }
                    b.Status = final ? "final-warning" : "warned";
                    b.RemedyBy = remedyBy;
                    events.Add(new BreachEvent(at, by, final ? "final-warning" : "warning", $"{label} sent {(a.Channel == "email" ? "by email" : "by post")}: put it right by {dateText}.", sentId));
                    await CloseTasksAsync(db, b, "CHK", by, writer, now, ct);
                    // A task to check, on the date, whether it was put right.
                    AddTask(db, b, "CHK", $"Check whether Unit {unit.Number} has put right: {rule.Title.ToLowerInvariant()}", $"{b.Ref} · rule {rule.Number}. If not, send a final warning or refer it to the trustees.",
                        person.DisplayName, now, new DateTimeOffset(remedyBy.ToDateTime(new TimeOnly(17, 0)), Sa), route);
                    break;
                case "note":
                    events.Add(new BreachEvent(at, by, "note", a.Text!.Trim()));
                    break;
                case "refer":
                    b.Status = "with-trustees";
                    events.Add(new BreachEvent(at, by, "referred", $"Referred to the trustees: {a.Note!.Trim()}"));
                    await CloseTasksAsync(db, b, "CHK", by, writer, now, ct);
                    var title = $"Decide on breach {b.Ref}: rule {rule.Number}, Unit {unit.Number}";
                    AddTask(db, b, "TR", title, a.Note.Trim(), person.DisplayName, now, now.AddDays(14), route);
                    await NotifyTrusteesAsync(db, notices, reads, b, title, a.Note.Trim(), route, writer, ct);
                    break;
                case "resolve":
                    b.Status = "resolved";
                    events.Add(new BreachEvent(at, by, "resolved", $"Resolved: {a.Note!.Trim()}"));
                    await CloseTasksAsync(db, b, "CHK", by, writer, now, ct);
                    await CloseTasksAsync(db, b, "TR", by, writer, now, ct);
                    break;
                default:
                    b.Status = "open";
                    b.RemedyBy = null;
                    events.Add(new BreachEvent(at, by, "reopened", $"Reopened: {a.Note!.Trim()}"));
                    break;
            }
            b.Events = JsonSerializer.Serialize(events, Json.Options);
            b.Version++;
            return Results.NoContent();
        }, ct);
    }

    private static Dictionary<string, string> CheckBreach(BreachRow b, BreachAction a, Person person)
    {
        switch (a.Type)
        {
            case "warn":
                if (b.Status == "resolved") return new() { ["id"] = "It’s resolved: reopen it first." };
                if (b.Status == "with-trustees") return new() { ["id"] = "It’s with the trustees now." };
                if (a.Final == true && b.Status == "open") return new() { ["final"] = "Send a first warning before a final one." };
                if (a.RemedyDays is not (>= 1 and <= 60)) return new() { ["remedyDays"] = "Between 1 and 60 days." };
                if ((a.Message ?? "").Trim().Length < 20) return new() { ["message"] = "Write the letter." };
                if (a.Channel is not ("email" or "post")) return new() { ["channel"] = "By email or by post." };
                if (a.Channel == "email" && !Settings.SettingsEndpoints.IsEmail(person.Email)) return new() { ["channel"] = $"{person.DisplayName} has no email address on record: send it by post." };
                return [];
            case "note":
                return (a.Text ?? "").Trim().Length >= 3 ? [] : new() { ["text"] = "Write a note." };
            case "refer":
                if (b.Status is "resolved" or "with-trustees") return new() { ["id"] = "It can’t be referred now." };
                return (a.Note ?? "").Trim().Length >= 5 ? [] : new() { ["note"] = "Tell the trustees what’s happened so far and what you recommend." };
            case "resolve":
                if (b.Status == "resolved") return new() { ["id"] = "Already resolved." };
                return (a.Note ?? "").Trim().Length >= 5 ? [] : new() { ["note"] = "How was it resolved?" };
            case "reopen":
                if (b.Status != "resolved") return new() { ["id"] = "It’s still open." };
                return (a.Note ?? "").Trim().Length >= 5 ? [] : new() { ["note"] = "Why is it being reopened?" };
            default:
                return new() { ["type"] = "Warn, note, refer, resolve or reopen." };
        }
    }

    /// <summary>The letter states the date: before the sign-off when it has one.</summary>
    private static string Letter(string message, string date)
    {
        var text = message.Trim().ReplaceLineEndings("\n");
        var line = $"Please put this right by {date}.";
        const string signOff = "\n\nKind regards";
        var at = text.IndexOf(signOff, StringComparison.Ordinal);
        return at >= 0 ? $"{text[..at]}\n\n{line}{text[at..]}" : $"{text}\n\n{line}";
    }

    private static void AddTask(HumoDbContext db, BreachRow b, string suffix, string title, string detail, string personName, DateTimeOffset now, DateTimeOffset due, string route) =>
        db.WorkItems.Add(new WorkItemRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = b.OrganisationId, SchemeId = b.SchemeId, Ref = $"{b.Ref}-{suffix}", Kind = "task", Type = "follow-up", Title = title, Detail = $"{detail} ({personName})",
            CreatedAt = now, DueAt = due, AssigneeId = b.AssigneeId, ApproverRoles = "[]", Evidence = "[]", Route = route, SourceId = b.Id,
        });

    private static async Task CloseTasksAsync(HumoDbContext db, BreachRow b, string suffix, string by, Actor writer, DateTimeOffset now, CancellationToken ct)
    {
        var reference = $"{b.Ref}-{suffix}";
        foreach (var w in await db.WorkItems.Where(x => x.SourceId == b.Id && x.Ref == reference && x.Status == "open").ToListAsync(ct))
        {
            w.Status = "done";
            w.DecidedBy = by;
            w.DecidedById = writer.Human.Id;
            w.DecidedAt = now;
        }
    }

    /// <summary>The board decides the next step, so the trustees with a sign-in are told as well as the task being raised.</summary>
    private static async Task NotifyTrusteesAsync(HumoDbContext db, Notices notices, PortfolioReads reads, BreachRow b, string title, string detail, string route, Actor writer, CancellationToken ct)
    {
        var trustees = (await db.Relationships.AsNoTracking().Where(r => r.SchemeId == b.SchemeId && r.Type == "trustee").ToListAsync(ct)).Where(reads.IsCurrent).Select(r => r.PersonId.ToString()).ToList();
        var users = await db.Users.AsNoTracking().Where(u => u.PersonId != null && trustees.Contains(u.PersonId) && u.Status == Humo.Domain.Access.IdentityStatuses.Active).Select(u => u.Id).ToListAsync(ct);
        foreach (var user in users) notices.ToPerson(user, writer.Human.Id, title, detail, route);
    }
}
