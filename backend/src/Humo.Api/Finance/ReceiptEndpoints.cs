using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Finance;

public sealed record AllocationDto(string AccountId, decimal Amount);
public sealed record ReceiptDto(string Id, int Version, string SchemeId, string BankAccount, string Date, decimal Amount, string Reference, string Payer, string Status,
    IReadOnlyList<AllocationDto> Allocations, string? AllocatedBy, bool AutoMatched, string Source, string? ImportBatchId, string CapturedBy);
public sealed record AllocatedToDto(AccountDto Account, UnitDto Unit, decimal Amount);
public sealed record ReceiptViewDto(ReceiptDto Receipt, SchemeDto Scheme, IReadOnlyList<AllocatedToDto> AllocatedTo);
public sealed record MatchViewDto(string AccountId, int Confidence, IReadOnlyList<string> Reasons, UnitSummaryDto Summary);

public sealed record AllocateRequest(List<AllocationDto> Allocations, bool RememberPayer, int? ExpectedVersion);
public sealed record VersionRequest(int? ExpectedVersion);
public sealed record RemoveReceiptRequest(string Reason, int? ExpectedVersion);
public sealed record NewReceiptRequest(string SchemeId, string Date, decimal Amount, string Reference, string? Payer);
public sealed record StatementRequest(string FileName, string Csv, StatementMapping Mapping);
public sealed record StatementPreviewDto(string FileName, IReadOnlyList<string> Header, IReadOnlyList<StatementLine> Receipts, IReadOnlyList<StatementLine> Duplicates, int Debits,
    IReadOnlyList<StatementLine> Invalid, decimal Total);
public sealed record StatementImportResultDto(string BatchId, int Imported, int Duplicates, int Debits, int Invalid, decimal Total);
public sealed record StatementImportBatchDto(string Id, string SchemeId, string BankAccount, string FileName, string At, string By, int Imported, int Duplicates, int Debits, int Invalid, decimal Total);

/// <summary>
/// Receipts on the API (slice 2a; docs/22 §1): capture, bank-statement import, matching with reasons, allocation
/// across accounts, suspense, and removal of a mistake. Receipts.Allocate, within the person's schemes, and the
/// customer's plan must include payment allocation.
/// </summary>
public static class ReceiptEndpoints
{
    private const string Permission = "Receipts.Allocate";
    private const string Feature = "payment-allocation";

    public static void MapReceipts(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("").RequireAuthorization();
        g.MapGet("/receipts", List);
        g.MapGet("/receipts/{id:guid}/matches", Matches);
        g.MapGet("/accounts/{id:guid}/suggested-receipts", SuggestedFor);
        g.MapPost("/receipts", Capture);
        g.MapPost("/receipts/{id:guid}/allocate", Allocate);
        g.MapPost("/receipts/{id:guid}/unallocate", Unallocate);
        g.MapPost("/receipts/{id:guid}/suspense", Suspense);
        g.MapPost("/receipts/{id:guid}/remove", Remove);
        g.MapGet("/schemes/{schemeId:guid}/statement-mapping", Mapping);
        g.MapPost("/schemes/{schemeId:guid}/statements/preview", Preview);
        g.MapPost("/schemes/{schemeId:guid}/statements/import", Import);
        g.MapGet("/statement-imports", Imports);
    }

    // ---- Reads ----

    private static async Task<IResult> List(string[]? schemeIds, int? page, int? pageSize, CurrentActor current, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can(Permission) && !actor.Can("Finance.View")) return Results.Ok(PortfolioReads.Page(new List<ReceiptViewDto>(), page, pageSize));
        var schemes = await reads.ReadableSchemes(actor, schemeIds, ct);
        var ids = schemes.Select(s => s.Id).ToList();
        var receipts = (await db.Receipts.Include(r => r.Allocations).Where(r => ids.Contains(r.SchemeId)).ToListAsync(ct))
            .OrderByDescending(r => r.Date).ThenByDescending(r => r.CreatedAt).ToList();
        return Results.Ok(PortfolioReads.Page(await Views(db, schemes, receipts, ct), page, pageSize));
    }

    private static async Task<IResult> Matches(Guid id, CurrentActor current, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var receipt = await Visible(actor, db, id, ct);
        if (receipt is null) return Problems.NotFound();
        return Results.Ok(await MatchesFor(db, reads, receipt, ct));
    }

    /// <summary>Unallocated receipts whose best match is this account ("did they pay and we missed it?").</summary>
    private static async Task<IResult> SuggestedFor(Guid id, CurrentActor current, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await AccountEndpoints.Readable(actor, db, id, ct) is not { } account || !actor.Can(Permission)) return Results.Ok(Array.Empty<ReceiptViewDto>());
        var scheme = await db.Schemes.FirstAsync(s => s.Id == account.SchemeId, ct);
        var open = await db.Receipts.Include(r => r.Allocations).Where(r => r.SchemeId == scheme.Id && r.Status == "unallocated").ToListAsync(ct);
        var mine = new List<Receipt>();
        foreach (var r in open)
            if ((await MatchesFor(db, reads, r, ct)).FirstOrDefault()?.AccountId == id.ToString()) mine.Add(r);
        return Results.Ok(await Views(db, [scheme], mine, ct));
    }

    private static async Task<IResult> Mapping(Guid schemeId, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can(Permission) || !await SchemeEndpoints.Visible(actor, db).AnyAsync(s => s.Id == schemeId, ct)) return Problems.NotFound();
        var row = await db.StatementMappings.FirstOrDefaultAsync(m => m.SchemeId == schemeId, ct);
        return row is null ? Problems.NotFound() : Results.Ok(JsonSerializer.Deserialize<StatementMapping>(row.Mapping, Json.Options));
    }

    private static async Task<IResult> Imports(string[]? schemeIds, CurrentActor current, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can(Permission)) return Results.Ok(Array.Empty<StatementImportBatchDto>());
        var ids = (await reads.ReadableSchemes(actor, schemeIds, ct)).Select(s => s.Id).ToList();
        var batches = (await db.StatementImports.Where(b => ids.Contains(b.SchemeId)).ToListAsync(ct)).OrderByDescending(b => b.At);
        return Results.Ok(batches.Select(b => new StatementImportBatchDto(b.Id.ToString(), b.SchemeId.ToString(), b.BankAccount, b.FileName, b.At.ToString("O"), b.By,
            b.Imported, b.Duplicates, b.Debits, b.Invalid, b.Total)));
    }

    /// <summary>What importing this file would do. Changes nothing.</summary>
    private static async Task<IResult> Preview(Guid schemeId, StatementRequest body, CurrentActor current, HumoDbContext db, AccountLedger ledger, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can(Permission) || !await SchemeEndpoints.Visible(actor, db).AnyAsync(s => s.Id == schemeId, ct)) return Problems.NotFound();
        var rows = BankStatement.ParseCsv(body.Csv ?? "");
        if (StatementProblems(rows, body.Mapping) is { Count: > 0 } problems) return Problems.Validation(problems);
        return Results.Ok(await PreviewOf(db, schemeId, body.FileName, rows, body.Mapping, ledger.Today, ct));
    }

    // ---- Commands ----

    /// <summary>A receipt captured by hand: unallocated, in the scheme's trust account. An exact duplicate is refused.</summary>
    private static async Task<IResult> Capture(NewReceiptRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, AccountLedger ledger, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var schemeId = Guid.TryParse(body.SchemeId, out var s) ? s : Guid.Empty;
        var scheme = await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(x => x.Id == schemeId, ct);
        var reference = (body.Reference ?? "").Trim();
        var dateProblem = BankStatement.ReceiptDateProblem(body.Date, ledger.Today);
        var duplicate = dateProblem is null && body.Amount > 0 && await IsDuplicate(db, schemeId, body.Date[..10], Ledger.Round2(body.Amount), reference, ct);
        var id = Guid.CreateVersion7();

        return await commands.RunAsync(new CommandSpec($"Captured a receipt of {Commercial.CommercialEndpoints.Rand(body.Amount)} (“{reference}”)", Permission)
        {
            Resource = "Receipt",
            ResourceId = id.ToString(),
            SchemeId = scheme?.Id,
            Feature = Feature,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (scheme is null) e["schemeId"] = "Choose the scheme.";
                if (dateProblem is not null) e["date"] = dateProblem;
                if (!(body.Amount > 0)) e["amount"] = "Enter the amount received.";
                if (reference.Length < 2) e["reference"] = "Enter the reference exactly as it appears on the bank statement.";
                if (e.Count == 0 && duplicate) e["reference"] = "This receipt is already captured (same date, amount and reference).";
                return e;
            },
        }, actor =>
        {
            db.Receipts.Add(new Receipt
            {
                Id = id, SchemeId = scheme!.Id, BankAccount = BankAccountLabel(scheme), Date = DateOnly.Parse(body.Date[..10]), Amount = Ledger.Round2(body.Amount), Reference = reference,
                Payer = (body.Payer ?? "").Trim(), Source = "captured", CapturedBy = actor.Human.Name, CreatedAt = DateTimeOffset.UtcNow,
            });
            return Task.FromResult(Results.Created($"/api/receipts/{id}", new { id = id.ToString() }));
        }, ct);
    }

    /// <summary>Imports the file's new credits as unallocated receipts, and remembers the column mapping for the scheme.</summary>
    private static async Task<IResult> Import(Guid schemeId, StatementRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, AccountLedger ledger, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var scheme = await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(x => x.Id == schemeId, ct);
        if (scheme is null) return Problems.NotFound();
        var rows = BankStatement.ParseCsv(body.Csv ?? "");
        var problems = StatementProblems(rows, body.Mapping);
        var preview = problems.Count == 0 ? await PreviewOf(db, schemeId, body.FileName, rows, body.Mapping, ledger.Today, ct) : null;
        var remembered = await db.StatementMappings.FirstOrDefaultAsync(m => m.SchemeId == schemeId, ct);
        var batchId = Guid.CreateVersion7();

        return await commands.RunAsync(new CommandSpec($"Imported bank statement “{body.FileName}”", Permission)
        {
            Resource = "Bank statement",
            ResourceId = batchId.ToString(),
            SchemeId = schemeId,
            Feature = Feature,
            Validate = () => problems,
        }, actor =>
        {
            var p = preview!;
            var now = DateTimeOffset.UtcNow;
            var label = BankAccountLabel(scheme);
            db.StatementImports.Add(new StatementImport
            {
                Id = batchId, SchemeId = schemeId, BankAccount = label, FileName = body.FileName, At = now, By = actor.Human.Name,
                Imported = p.Receipts.Count, Duplicates = p.Duplicates.Count, Debits = p.Debits, Invalid = p.Invalid.Count, Total = p.Total,
            });
            foreach (var l in p.Receipts)
                db.Receipts.Add(new Receipt
                {
                    Id = Guid.CreateVersion7(), SchemeId = schemeId, BankAccount = label, Date = DateOnly.Parse(l.Date!), Amount = l.Amount!.Value, Reference = l.Reference ?? "",
                    Payer = l.Payer ?? "", Source = "statement-import", ImportBatchId = batchId, CapturedBy = actor.Human.Name, CreatedAt = now,
                });
            var mapping = JsonSerializer.Serialize(body.Mapping, Json.Options);
            if (remembered is not null) remembered.Mapping = mapping;
            else db.StatementMappings.Add(new StatementMappingSetting { SchemeId = schemeId, Mapping = mapping });
            return Task.FromResult(Results.Ok(new StatementImportResultDto(batchId.ToString(), p.Receipts.Count, p.Duplicates.Count, p.Debits, p.Invalid.Count, p.Total)));
        }, ct);
    }

    /// <summary>Allocates the whole receipt across one or more accounts in its scheme: a payment line on each.</summary>
    private static async Task<IResult> Allocate(Guid id, AllocateRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, AccountLedger ledger, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await Visible(me, db, id, ct) is not { } receipt) return Problems.NotFound();
        var parts = body.Allocations ?? [];
        var accountIds = parts.Select(a => Guid.TryParse(a.AccountId, out var g) ? g : Guid.Empty).ToList();
        var accounts = await db.LevyAccounts.Where(a => accountIds.Contains(a.Id) && a.SchemeId == receipt.SchemeId).ToDictionaryAsync(a => a.Id, ct);
        var total = Ledger.Round2(parts.Sum(a => a.Amount));
        var to = string.Join(", ", accounts.Values.Select(a => a.AccountNo));

        return await commands.RunAsync(new CommandSpec($"Allocated receipt {Commercial.CommercialEndpoints.Rand(receipt.Amount)} (“{receipt.Reference}”) to {to}", Permission)
        {
            Resource = "Receipt",
            ResourceId = id.ToString(),
            SchemeId = receipt.SchemeId,
            Feature = Feature,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = receipt.Version,
            Validate = () =>
            {
                if (receipt.Status == "allocated") return new() { ["receiptId"] = "It’s already allocated. Reverse the allocation first." };
                if (parts.Count == 0) return new() { ["allocations"] = "Choose the account it pays." };
                if (accountIds.Distinct().Count() != parts.Count || accountIds.Any(a => !accounts.ContainsKey(a))) return new() { ["allocations"] = "Each account once, in this receipt’s scheme." };
                if (parts.Any(a => a.Amount <= 0)) return new() { ["allocations"] = "Each amount must be more than zero." };
                return total != receipt.Amount ? new() { ["allocations"] = $"The amounts must add up to the receipt ({Commercial.CommercialEndpoints.Rand(receipt.Amount)})." } : [];
            },
        }, async actor =>
        {
            foreach (var part in parts)
            {
                var account = accounts[Guid.Parse(part.AccountId)];
                db.ReceiptAllocations.Add(new ReceiptAllocation { ReceiptId = receipt.Id, AccountId = account.Id, Amount = Ledger.Round2(part.Amount) });
                await ledger.PostAsync(account, receipt.Date, TransactionTypes.Payment, "Payment received — thank you", -part.Amount, actor.Human.Name, receipt.Reference, receipt.Id, ct);
            }
            receipt.Status = "allocated";
            receipt.AllocatedBy = actor.Human.Name;
            receipt.Version++;
            // "Remember this payer": the next receipt with the same payer or reference is suggested first.
            if (body.RememberPayer && parts.Count == 1 && (receipt.Payer.Length > 0 ? receipt.Payer : receipt.Reference).Trim() is { Length: > 0 } pattern)
            {
                var accountId = accountIds[0];
                if (!await db.PayerRules.AnyAsync(r => r.SchemeId == receipt.SchemeId && r.Pattern == pattern && r.AccountId == accountId, ct))
                    db.PayerRules.Add(new PayerRule { Id = Guid.CreateVersion7(), SchemeId = receipt.SchemeId, Pattern = pattern, AccountId = accountId, CreatedBy = actor.Human.Name, CreatedAt = DateTimeOffset.UtcNow });
            }
            return Results.NoContent();
        }, ct);
    }

    /// <summary>Reverses an allocation: its payment lines come off the accounts and the receipt is unallocated again.</summary>
    private static async Task<IResult> Unallocate(Guid id, VersionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, AccountLedger ledger, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await Visible(me, db, id, ct) is not { } receipt) return Problems.NotFound();
        return await commands.RunAsync(new CommandSpec($"Reversed the allocation of receipt {Commercial.CommercialEndpoints.Rand(receipt.Amount)} (“{receipt.Reference}”)", Permission)
        {
            Resource = "Receipt",
            ResourceId = id.ToString(),
            SchemeId = receipt.SchemeId,
            Feature = Feature,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = receipt.Version,
            Validate = () => receipt.Status != "allocated" ? new() { ["receiptId"] = "It isn’t allocated." } : [],
        }, async _ =>
        {
            var lines = await db.Ledger.Where(e => e.ReceiptId == receipt.Id).ToListAsync(ct);
            db.Ledger.RemoveRange(lines);
            db.ReceiptAllocations.RemoveRange(receipt.Allocations);
            foreach (var accountId in lines.Select(l => l.AccountId).Distinct())
                await ledger.RecalculateAsync(await db.LevyAccounts.FirstAsync(a => a.Id == accountId, ct), ct);
            receipt.Status = "unallocated";
            receipt.AllocatedBy = null;
            receipt.Version++;
            return Results.NoContent();
        }, ct);
    }

    private static async Task<IResult> Suspense(Guid id, VersionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await Visible(me, db, id, ct) is not { } receipt) return Problems.NotFound();
        return await commands.RunAsync(new CommandSpec($"Moved receipt {Commercial.CommercialEndpoints.Rand(receipt.Amount)} (“{receipt.Reference}”) to suspense", Permission)
        {
            Resource = "Receipt",
            ResourceId = id.ToString(),
            SchemeId = receipt.SchemeId,
            Feature = Feature,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = receipt.Version,
            Validate = () => receipt.Status != "unallocated" ? new() { ["receiptId"] = "Only an unallocated receipt can go to suspense." } : [],
        }, actor =>
        {
            receipt.Status = "suspense";
            receipt.AllocatedBy = actor.Human.Name;
            receipt.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>Removes a mistaken receipt: only while unallocated, with a reason. Audited.</summary>
    private static async Task<IResult> Remove(Guid id, RemoveReceiptRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await Visible(me, db, id, ct) is not { } receipt) return Problems.NotFound();
        var reason = (body.Reason ?? "").Trim();
        return await commands.RunAsync(new CommandSpec($"Removed receipt {Commercial.CommercialEndpoints.Rand(receipt.Amount)} (“{receipt.Reference}”) — {reason}", Permission)
        {
            Resource = "Receipt",
            ResourceId = id.ToString(),
            SchemeId = receipt.SchemeId,
            Feature = Feature,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = receipt.Version,
            Validate = () =>
                receipt.Status == "allocated" ? new() { ["status"] = "It’s allocated. Reverse the allocation first." }
                : receipt.Status != "unallocated" ? new() { ["status"] = "Only an unallocated receipt can be removed." }
                : reason.Length < 5 ? new() { ["reason"] = "Say why, in a few words. It goes in the audit log." } : [],
        }, _ =>
        {
            db.Receipts.Remove(receipt);
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    // ---- Helpers ----

    /// <summary>A receipt in one of the person's schemes, for someone who works with receipts; otherwise "not found".</summary>
    private static async Task<Receipt?> Visible(Actor actor, HumoDbContext db, Guid id, CancellationToken ct)
    {
        var r = await db.Receipts.Include(x => x.Allocations).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null || !actor.Can(Permission)) return null;
        return await SchemeEndpoints.Visible(actor, db).AnyAsync(s => s.Id == r.SchemeId, ct) ? r : null;
    }

    /// <summary>"Trust account": the scheme's bank details arrive with Settings › Agency on the API (slice 2c).</summary>
    private static string BankAccountLabel(Scheme scheme) => $"{scheme.Code} trust account";

    private static async Task<bool> IsDuplicate(HumoDbContext db, Guid schemeId, string date, decimal amount, string reference, CancellationToken ct)
    {
        var key = BankStatement.ReceiptKey(schemeId, date, amount, reference);
        return (await Keys(db, schemeId, ct)).Contains(key);
    }

    private static async Task<HashSet<string>> Keys(HumoDbContext db, Guid schemeId, CancellationToken ct) =>
        (await db.Receipts.Where(r => r.SchemeId == schemeId).Select(r => new { r.Date, r.Amount, r.Reference }).ToListAsync(ct))
            .Select(r => BankStatement.ReceiptKey(schemeId, r.Date.ToString("yyyy-MM-dd"), r.Amount, r.Reference)).ToHashSet();

    private static Dictionary<string, string> StatementProblems(List<string[]> rows, StatementMapping? mapping)
    {
        if (mapping is null) return new() { ["mapping"] = "Map the columns first." };
        if (rows.Count < 2) return new() { ["file"] = "The file has no rows under the header." };
        return BankStatement.MappingProblems(rows[0], mapping);
    }

    /// <summary>The import's outcome, row by row: dates outside the allowed range can't be read; duplicates (of receipts there, or earlier in the file) are skipped.</summary>
    private static async Task<StatementPreviewDto> PreviewOf(HumoDbContext db, Guid schemeId, string fileName, List<string[]> rows, StatementMapping mapping, DateOnly today, CancellationToken ct)
    {
        var lines = BankStatement.Read(rows, mapping).Select(l =>
            l.Kind == "credit" && BankStatement.ReceiptDateProblem(l.Date, today) is { } p ? l with { Kind = "invalid", Problem = p } : l).ToList();
        var seen = await Keys(db, schemeId, ct);
        var receipts = new List<StatementLine>();
        var duplicates = new List<StatementLine>();
        foreach (var l in lines.Where(x => x.Kind == "credit"))
        {
            if (seen.Add(BankStatement.ReceiptKey(schemeId, l.Date!, l.Amount!.Value, l.Reference ?? ""))) receipts.Add(l);
            else duplicates.Add(l);
        }
        return new StatementPreviewDto(fileName, rows.FirstOrDefault() ?? [], receipts, duplicates, lines.Count(l => l.Kind == "debit"), lines.Where(l => l.Kind == "invalid").ToList(),
            Ledger.Round2(receipts.Sum(l => l.Amount ?? 0)));
    }

    private static async Task<List<MatchViewDto>> MatchesFor(HumoDbContext db, PortfolioReads reads, Receipt receipt, CancellationToken ct)
    {
        var scheme = await db.Schemes.FirstAsync(s => s.Id == receipt.SchemeId, ct);
        var summaries = await reads.Units([scheme], null, ct);
        var rules = await db.PayerRules.Where(r => r.SchemeId == scheme.Id).Select(r => new { r.Pattern, r.AccountId }).ToListAsync(ct);
        var candidates = summaries.Select(s => new MatchCandidate(Guid.Parse(s.Account.Id), s.Account.AccountNo, s.Unit.Number, s.Unit.MonthlyLevy, s.Account.Balance,
            s.Owners.Select(o => (o.FirstName, o.LastName, o.DisplayName)).ToList(), s.Tenant is { } t ? (t.LastName, t.DisplayName) : null)).ToList();
        var byAccount = summaries.ToDictionary(s => s.Account.Id);
        return ReceiptMatching.Match(receipt.Reference, receipt.Payer, receipt.Amount, scheme.Code, candidates, rules.Select(r => (r.Pattern, r.AccountId)))
            .Select(m => new MatchViewDto(m.AccountId.ToString(), m.Confidence, m.Reasons, byAccount[m.AccountId.ToString()])).ToList();
    }

    private static async Task<List<ReceiptViewDto>> Views(HumoDbContext db, List<Scheme> schemes, List<Receipt> receipts, CancellationToken ct)
    {
        var schemeDtos = (await SchemeEndpoints.ToDtos(schemes, db, ct)).ToDictionary(s => s.Id);
        var accountIds = receipts.SelectMany(r => r.Allocations).Select(a => a.AccountId).Distinct().ToList();
        var accounts = await db.LevyAccounts.Where(a => accountIds.Contains(a.Id)).ToDictionaryAsync(a => a.Id, ct);
        var unitIds = accounts.Values.Select(a => a.UnitId).ToList();
        var units = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        return receipts.Select(r => new ReceiptViewDto(ToDto(r), schemeDtos[r.SchemeId.ToString()],
            r.Allocations.Select(a => new AllocatedToDto(PortfolioReads.ToDto(accounts[a.AccountId]), PortfolioReads.ToDto(units[accounts[a.AccountId].UnitId]), a.Amount)).ToList())).ToList();
    }

    private static ReceiptDto ToDto(Receipt r) => new(r.Id.ToString(), r.Version, r.SchemeId.ToString(), r.BankAccount, $"{r.Date:yyyy-MM-dd}T09:00:00+02:00", r.Amount, r.Reference, r.Payer,
        r.Status, r.Allocations.Select(a => new AllocationDto(a.AccountId.ToString(), a.Amount)).ToList(), r.AllocatedBy, r.AutoMatched, r.Source, r.ImportBatchId?.ToString(), r.CapturedBy);
}
