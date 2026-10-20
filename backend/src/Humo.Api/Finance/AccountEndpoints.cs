using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Finance;

public sealed record TransactionDto(string Id, string AccountId, string Date, string Type, string Description, string? Reference, decimal Amount, decimal Balance, string? ReceiptId);
public sealed record AccountDetailDto(AccountDto Account, UnitDto Unit, SchemeDto Scheme, PersonDto Holder, IReadOnlyList<TransactionDto> Transactions,
    IReadOnlyList<string> StatementPeriods, TransactionDto? LastPayment);
public sealed record AdjustmentRequest(decimal Amount, string Reason);

/// <summary>
/// Levy accounts on the API (slice 2a; docs/11 §3): the ledger with running balances and ageing from
/// the actual transactions, and journal adjustments (corrections are new lines, never edits).
/// </summary>
public static class AccountEndpoints
{
    /// <summary>Bigger corrections need a correction run (docs/11 §1).</summary>
    public const decimal AdjustmentCap = 100_000;

    public static void MapAccounts(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/accounts").RequireAuthorization();
        g.MapGet("/{id:guid}", Get);
        g.MapPost("/{id:guid}/adjustments", Adjust);
    }

    /// <summary>
    /// The account as its scheme's staff see it (Accounts.View, within their schemes), or as its holder sees
    /// their own (Account.ViewOwn). Someone else's account is "not found" (doc 24 S6).
    /// </summary>
    internal static async Task<LevyAccount?> Readable(Actor actor, HumoDbContext db, Guid id, CancellationToken ct)
    {
        var account = await db.LevyAccounts.FirstOrDefaultAsync(a => a.Id == id, ct);
        if (account is null) return null;
        if (actor.Can("Accounts.View") && await SchemeEndpoints.Visible(actor, db).AnyAsync(s => s.Id == account.SchemeId, ct)) return account;
        if (actor.Can("Account.ViewOwn") && actor.User.PersonId is { } person && account.HolderPersonId?.ToString() == person) return account;
        return null;
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        // A new unit has no account holder until an owner is linked.
        if (await Readable(actor, db, id, ct) is not { HolderPersonId: { } holderId } account) return Problems.NotFound();
        var unit = await db.Units.FirstAsync(u => u.Id == account.UnitId, ct);
        var scheme = await db.Schemes.FirstAsync(s => s.Id == account.SchemeId, ct);
        var holder = await db.People.FirstAsync(p => p.Id == holderId, ct);
        var lines = await db.Ledger.Where(e => e.AccountId == id).ToListAsync(ct);
        var transactions = WithBalances(lines);
        var periods = lines.Select(l => l.Date.ToString("yyyy-MM")).Distinct().OrderDescending().ToList();
        return Results.Ok(new AccountDetailDto(PortfolioReads.ToDto(account), PortfolioReads.ToDto(unit), (await SchemeEndpoints.ToDtos([scheme], db, ct))[0],
            PortfolioReads.ToDto(holder), transactions, periods, transactions.FirstOrDefault(t => t.Type == TransactionTypes.Payment)));
    }

    /// <summary>Newest first, each with the balance after it.</summary>
    internal static List<TransactionDto> WithBalances(IEnumerable<LedgerEntry> lines)
    {
        decimal balance = 0;
        var list = new List<TransactionDto>();
        foreach (var e in lines.OrderBy(e => e.Date).ThenBy(e => e.CreatedAt))
        {
            balance = Ledger.Round2(balance + e.Amount);
            list.Add(new TransactionDto(e.Id.ToString(), e.AccountId.ToString(), e.Date.ToString("yyyy-MM-dd"), e.Type, e.Description, e.Reference, e.Amount, balance, e.ReceiptId?.ToString()));
        }
        list.Reverse();
        return list;
    }

    /// <summary>A journal adjustment: positive charges the account, negative credits it. A correction after posting is always one of these, never an edit.</summary>
    private static async Task<IResult> Adjust(Guid id, AdjustmentRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, AccountLedger ledger, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await Readable(me, db, id, ct) is not { } account || !me.Can("Accounts.View")) return Problems.NotFound();
        var reason = (body.Reason ?? "").Trim();
        return await commands.RunAsync(new CommandSpec($"Journal adjustment of {Commercial.CommercialEndpoints.Rand(body.Amount)} on {account.AccountNo} — {reason}", "Billing.Run")
        {
            Resource = "Account",
            ResourceId = id.ToString(),
            SchemeId = account.SchemeId,
            Feature = "finance-basic",
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (body.Amount == 0) e["amount"] = "Enter the amount: positive to charge, negative to credit.";
                else if (Math.Abs(body.Amount) > AdjustmentCap) e["amount"] = "Corrections over R100 000 need a correction run.";
                if (reason.Length < 5) e["reason"] = "Say why, in a few words. It shows on the statement and in the audit log.";
                return e;
            },
        }, async actor =>
        {
            await ledger.PostAsync(account, ledger.Today, TransactionTypes.Adjustment, $"Adjustment — {reason}", body.Amount, actor.Human.Name, actor.Human.Name, ct: ct);
            return Results.NoContent();
        }, ct);
    }
}
