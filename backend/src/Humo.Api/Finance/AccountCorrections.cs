using System.Security.Cryptography;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Files;
using Humo.Api.Portfolio;
using Humo.Api.Work;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Files;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Finance;

public sealed record AccountCorrectionDto(string Id, string Kind, decimal Amount, string? LineId, string Reason, string Status, string PreparedBy, string PreparedAt, string? WorkItemId);

/// <summary>
/// D40: taking money off a levy account. A reversal undoes a charge made in error (a second person approves it); a write-off
/// gives up what's owed (the board approves it, D39). Either is a new line on the account once approved, linked to the
/// charge or dispute it came from. A credit never goes on by journal.
/// </summary>
public sealed class AccountCorrections(HumoDbContext db, AccountLedger ledger, TimeProvider clock)
{
    public const string Type = "account-correction";
    public const string Reversal = "reversal", WriteOff = "write-off";

    /// <summary>Lines that put money on the account and so can be reversed.</summary>
    private static readonly string[] Charges = [TransactionTypes.Levy, TransactionTypes.SpecialLevy, TransactionTypes.Utility, TransactionTypes.Interest, TransactionTypes.Adjustment, TransactionTypes.Opening];

    /// <summary>What's left of a charge to reverse: approved and waiting reversals count against it, so it can't be reversed twice.</summary>
    private async Task<decimal> ReversibleAsync(LedgerEntry line, CancellationToken ct)
    {
        var taken = await db.AccountCorrections.Where(c => c.LineId == line.Id && c.Status != "rejected").SumAsync(c => (decimal?)c.Amount, ct) ?? 0;
        return Ledger.Round2(line.Amount - taken);
    }

    public async Task<Dictionary<string, string>> CheckAsync(LevyAccount account, string? kind, decimal? amount, string? lineId, string? reason, CancellationToken ct)
    {
        var e = new Dictionary<string, string>();
        if (kind is not (Reversal or WriteOff)) { e["kind"] = "A reversal of a charge, or a write-off."; return e; }
        if (amount is not > 0) e["amount"] = "Enter the amount to take off.";
        if ((reason ?? "").Trim().Length < 5) e["reason"] = "Say why. It goes on the owner’s statement and in the audit log.";
        if (kind == Reversal)
        {
            var line = Guid.TryParse(lineId, out var id) ? await db.Ledger.FirstOrDefaultAsync(l => l.Id == id && l.AccountId == account.Id, ct) : null;
            if (line is null || line.Amount <= 0 || !Charges.Contains(line.Type)) e["lineId"] = "Choose the charge that was made in error.";
            else if (amount is > 0 && amount > await ReversibleAsync(line, ct))
                e["amount"] = await ReversibleAsync(line, ct) is var left && left <= 0 ? "That charge has already been reversed." : $"At most {BillingRules.Rand(left)}: what’s left of that charge.";
        }
        else if (amount is > 0 && amount > account.Balance) e["amount"] = $"At most {BillingRules.Rand(Math.Max(0, account.Balance))}: what’s owed.";
        if (await db.AccountCorrections.AnyAsync(c => c.AccountId == account.Id && c.Status == "pending" && c.Kind == WriteOff, ct) && kind == WriteOff)
            e["kind"] = "A write-off on this account is already waiting for the board.";
        return e;
    }

    /// <summary>Records the correction and puts it in Approvals: a second person for a reversal, the board for a write-off. The caller saves.</summary>
    public async Task<AccountCorrection> CreateAsync(LevyAccount account, string kind, decimal amount, string? lineId, string reason, Guid? fileId, Actor actor, bool fromDispute,
        CancellationToken ct)
    {
        var scheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == account.SchemeId, ct);
        var unit = await db.Units.AsNoTracking().FirstAsync(u => u.Id == account.UnitId, ct);
        var line = Guid.TryParse(lineId, out var lid) ? await db.Ledger.AsNoTracking().FirstOrDefaultAsync(l => l.Id == lid, ct) : null;
        var correction = new AccountCorrection
        {
            Id = Guid.CreateVersion7(), OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, AccountId = account.Id, Kind = kind, Amount = Ledger.Round2(amount),
            LineId = line?.Id, Reason = reason.Trim(), FileId = fileId, Status = "pending", FromDispute = fromDispute, PreparedBy = actor.Human.Name, PreparedById = actor.Human.Id,
            PreparedAt = clock.GetUtcNow(),
        };
        var what = kind == Reversal ? $"Reverse {BillingRules.Rand(amount)} charged in error on {account.AccountNo}" : $"Write off {BillingRules.Rand(amount)} owed on {account.AccountNo}";
        var item = new WorkItemRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, Ref = account.AccountNo, Kind = "approval", Type = Type, Title = what,
            Detail = reason.Trim(), Amount = correction.Amount, CreatedAt = clock.GetUtcNow(), DueAt = clock.GetUtcNow().AddDays(3),
            // D40: a reversal by a second person at the agency; a write-off by the board (D39).
            ApproverRoles = kind == Reversal ? WorkItemEndpoints.Roles(Roles.AgencyAdmin, Roles.Finance) : WorkItemEndpoints.Roles(Roles.Trustee), BoardMajority = kind == WriteOff,
            Evidence = JsonSerializer.Serialize(new[]
            {
                line is null ? null : $"Charge: {line.Description}, {line.Date:d MMM yyyy}, {BillingRules.Rand(line.Amount)}",
                fromDispute ? "From the owner’s dispute" : null,
                fileId is null ? null : "Supporting document attached",
                $"Prepared by {actor.Human.Name}",
            }.Where(x => x is not null)),
            Route = $"/schemes/{scheme.Id}/units/{unit.Number}/account", SourceId = correction.Id,
        };
        correction.WorkItemId = item.Id;
        db.AccountCorrections.Add(correction);
        db.WorkItems.Add(item);
        return correction;
    }

    /// <summary>Approved: the line goes on the account. The caller saves.</summary>
    public async Task PostAsync(AccountCorrection correction, string by, CancellationToken ct)
    {
        var account = await db.LevyAccounts.FirstAsync(a => a.Id == correction.AccountId, ct);
        var line = correction.LineId is { } id ? await db.Ledger.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id, ct) : null;
        var description = correction.Kind == Reversal
            ? $"Reversal of {line?.Description ?? "a charge"} ({line?.Date:d MMM yyyy}) — {correction.Reason}"
            : $"Written off by the board — {correction.Reason}";
        await ledger.PostAsync(account, ledger.Today, TransactionTypes.Adjustment, description, -correction.Amount, by, reference: correction.Id.ToString(), ct: ct);
    }
}

/// <summary>A correction decided in My work: approved, it's posted; rejected, it isn't, and a dispute it came from is open again.</summary>
public sealed class AccountCorrectionHandler(HumoDbContext db, AccountCorrections corrections, CreditControl credit, TimeProvider clock) : IApprovalHandler
{
    public string Type => AccountCorrections.Type;

    public async Task<string?> RefuseAsync(WorkItemRow item, Actor actor, bool approve, CancellationToken ct)
    {
        if (!approve || item.SourceId is not { } id || await db.AccountCorrections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, ct) is not { } correction) return null;
        return correction.PreparedById == actor.Human.Id ? "You prepared this correction: someone else approves it." : null;
    }

    public async Task DecidedAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct)
    {
        if (item.SourceId is not { } id || await db.AccountCorrections.FirstOrDefaultAsync(c => c.Id == id, ct) is not { Status: "pending" } correction) return;
        correction.Status = approve ? "approved" : "rejected";
        correction.DecidedBy = actor.Human.Name;
        correction.DecidedAt = clock.GetUtcNow();
        if (approve) await corrections.PostAsync(correction, actor.Human.Name, ct);
        if (correction.FromDispute) await credit.CorrectionDecidedAsync(correction, approve, actor.Human.Name, comment, ct);
    }
}

/// <summary>
///   POST /accounts/{id}/corrections   a reversal or write-off from the account page (multipart: kind, amount, lineId, reason, optional PDF)
/// </summary>
public static class AccountCorrectionEndpoints
{
    public static void MapAccountCorrections(this IEndpointRouteBuilder api) =>
        api.MapPost("/accounts/{id:guid}/corrections", Create).RequireAuthorization().DisableAntiforgery();

    private static async Task<IResult> Create(Guid id, HttpRequest request, CurrentActor current, CommandRunner commands, HumoDbContext db, AccountCorrections corrections,
        IFileStore store, IFileScanner scanner, IOptions<FilesOptions> options, Commercial.PackageLimits limits, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await AccountEndpoints.Readable(actor, db, id, ct) is not { } account || !actor.Can("Accounts.View")) return Problems.NotFound();
        var form = await request.ReadFormAsync(ct);
        var kind = form["kind"].ToString();
        var amount = decimal.TryParse(form["amount"].ToString(), System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var a) ? a : (decimal?)null;
        var lineId = form["lineId"].ToString() is { Length: > 0 } l ? l : null;
        var reason = form["reason"].ToString();
        var errors = await corrections.CheckAsync(account, kind, amount, lineId, reason, ct);
        PdfIntake.Accepted? file = null;
        if (errors.Count == 0 && form.Files.Count > 0)
        {
            var (accepted, refusal) = await PdfIntake.CheckAsync(form.Files.FirstOrDefault(), options.Value.MaxBytes, scanner, ct);
            if (refusal is not null) return refusal;
            if (await limits.RefuseNewFileAsync(await db.Schemes.Where(s => s.Id == account.SchemeId).Select(s => s.OrganisationId).FirstAsync(ct), accepted!.Bytes.Length, ct) is { } full)
                return Problems.Validation(new() { ["file"] = full });
            file = accepted;
        }

        return await commands.RunAsync(new CommandSpec($"Asked for {(kind == AccountCorrections.WriteOff ? "a write-off" : "a reversal")} of {BillingRules.Rand(amount ?? 0)} on {account.AccountNo} (D40): {reason.Trim()}", "Billing.Run")
        {
            Resource = "Account",
            ResourceId = account.AccountNo,
            SchemeId = account.SchemeId,
            Feature = "finance-basic",
            Validate = () => errors,
        }, async writer =>
        {
            Guid? fileId = null;
            if (file is not null)
            {
                var key = await store.SaveAsync(file.Bytes, ct);
                fileId = Guid.CreateVersion7();
                db.UploadedFiles.Add(new UploadedFile
                {
                    Id = fileId.Value, OrganisationId = await db.Schemes.Where(s => s.Id == account.SchemeId).Select(s => s.OrganisationId).FirstAsync(ct), SchemeId = account.SchemeId,
                    Name = file.Name, ContentType = "application/pdf", SizeBytes = file.Bytes.Length, Sha256 = Convert.ToHexStringLower(SHA256.HashData(file.Bytes)), StorageKey = key,
                    ScanResult = "clean", UploadedBy = writer.Human.Name, UploadedAt = clock.GetUtcNow(),
                });
            }
            var correction = await corrections.CreateAsync(account, kind, amount!.Value, lineId, reason, fileId, writer, fromDispute: false, ct);
            return Results.Created($"/api/accounts/{id}", new { id = correction.Id.ToString() });
        }, ct);
    }
}
