using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Maintenance;
using Humo.Api.Portfolio;
using Humo.Api.Work;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Finance;

/// <summary>
/// Finance › Payables on the API (slice 3b, D27): supplier invoices and payment batches in the person's schemes
/// (Finance.View to read), prepared with Payables.Prepare, released with Payables.Release and a passkey.
/// </summary>
public static class PayablesEndpoints
{
    public static void MapPayables(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/payables").RequireAuthorization();
        g.MapGet("/invoices", Invoices);
        g.MapGet("/batches", Batches);
        g.MapPost("/batches", Create);
        g.MapPost("/batches/{id:guid}/release", Release);
        g.MapPost("/batches/{id:guid}/payment-file", PaymentFile);
        g.MapPost("/batches/{id:guid}/cancel", Cancel);
    }

    private static async Task<List<Guid>?> SchemesAsync(Actor actor, HumoDbContext db, string[]? schemeIds, CancellationToken ct)
    {
        if (actor.OrganisationId is null || !actor.Can("Finance.View")) return null;
        var wanted = (schemeIds ?? []).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).ToHashSet();
        return [.. (await SchemeEndpoints.Visible(actor, db).Select(x => x.Id).ToListAsync(ct)).Where(wanted.Contains)];
    }

    private static async Task<IResult> Invoices(string[]? schemeIds, CurrentActor current, HumoDbContext db, MaintenanceService m, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await SchemesAsync(actor, db, schemeIds, ct) is not { } schemes) return Results.Ok(Array.Empty<InvoiceViewDto>());
        var rows = (await db.SupplierInvoices.Where(i => i.OrganisationId == actor.OrganisationId && schemes.Contains(i.SchemeId)).ToListAsync(ct)).OrderBy(i => i.DueOn).ToList();
        return Results.Ok(await m.InvoiceViewsAsync(rows, ct));
    }

    private static async Task<IResult> Batches(string[]? schemeIds, CurrentActor current, HumoDbContext db, Payables payables, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await SchemesAsync(actor, db, schemeIds, ct) is not { } schemes) return Results.Ok(Array.Empty<BatchViewDto>());
        var rows = (await db.PaymentBatches.Where(b => b.OrganisationId == actor.OrganisationId && schemes.Contains(b.SchemeId)).ToListAsync(ct)).OrderByDescending(b => b.CreatedAt).ToList();
        return Results.Ok(await payables.ViewsAsync(rows, ct));
    }

    private static async Task<PaymentBatchRow?> VisibleBatchAsync(Actor actor, HumoDbContext db, Guid id, CancellationToken ct)
    {
        if (actor.OrganisationId is not { } org) return null;
        var row = await db.PaymentBatches.FirstOrDefaultAsync(b => b.Id == id && b.OrganisationId == org, ct);
        return row is not null && await SchemeEndpoints.Visible(actor, db).AnyAsync(s => s.Id == row.SchemeId, ct) ? row : null;
    }

    /// <summary>Approved invoices of one scheme, to suppliers with verified bank details, into a batch sent for approval. Returns its id.</summary>
    private static async Task<IResult> Create(NewBatchRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Payables payables, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org } me) return Results.Unauthorized();
        var ids = (body.InvoiceIds ?? []).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).Distinct().ToList();
        var visible = await SchemeEndpoints.Visible(me, db).Select(s => s.Id).ToListAsync(ct);
        var invoices = await db.SupplierInvoices.Where(i => ids.Contains(i.Id) && i.OrganisationId == org && visible.Contains(i.SchemeId)).ToListAsync(ct);
        var schemeIds = invoices.Select(i => i.SchemeId).Distinct().ToList();
        var scheme = schemeIds.Count == 1 ? await db.Schemes.FirstAsync(s => s.Id == schemeIds[0], ct) : null;
        var supplierIds = invoices.Select(i => i.SupplierId).Distinct().ToList();
        var suppliers = await db.Suppliers.Where(s => supplierIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        var unverified = suppliers.Values.Where(s => !s.BankVerified).Select(s => s.Name).Order().ToList();
        var total = Ledger.Round2(invoices.Sum(i => i.Amount));

        return await commands.RunAsync(new CommandSpec($"Prepared a payment batch: {invoices.Count} invoice{(invoices.Count == 1 ? "" : "s")}, {BillingRules.Rand(total)}{(scheme is null ? "" : $", {scheme.Name}")}", "Payables.Prepare")
        {
            Resource = "Payment batch",
            SchemeId = scheme?.Id,
            Feature = "payables",
            Validate = () =>
                ids.Count == 0 ? new() { ["invoiceIds"] = "Choose the invoices to pay." }
                : invoices.Count != ids.Count ? new() { ["invoiceIds"] = "Some of these invoices aren’t yours to pay." }
                : scheme is null ? new() { ["invoiceIds"] = "A batch pays from one scheme’s trust account: choose invoices of one scheme." }
                : invoices.Any(i => i.Status != "approved") ? new() { ["invoiceIds"] = "Only approved invoices that aren’t in a batch can be paid." }
                : unverified.Count > 0 ? new() { ["invoiceIds"] = $"Bank details aren’t verified for {string.Join(", ", unverified)}: payments to them are held." }
                : [],
        }, async actor =>
        {
            var batchRef = await payables.NextRefAsync(scheme!, ct);
            var payees = Payables.PayeesFor(invoices, suppliers, scheme!.Code, batchRef);
            var batch = new PaymentBatchRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = org, SchemeId = scheme.Id, Ref = batchRef, Total = total, Status = "awaiting-approval",
                Payees = JsonSerializer.Serialize(payees, Json.Options), CreatedAt = payables.Now, CreatedById = actor.Human.Id, CreatedBy = actor.Human.Name,
            };
            var item = new WorkItemRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = org, SchemeId = scheme.Id, Ref = batchRef, Kind = "approval", Type = "payment-batch-approval",
                Title = $"Payment batch {batchRef} — {payees.Count} supplier {(payees.Count == 1 ? "payment" : "payments")}",
                Detail = $"From {scheme.Name}’s trust account. Every invoice approved; every bank account verified. Someone other than {actor.Human.Name}, who prepared it, approves it.",
                Amount = total, CreatedAt = payables.Now, DueAt = payables.Now.AddDays(2), ApproverRoles = WorkItemEndpoints.Roles([.. Payables.Approvers]),
                Evidence = JsonSerializer.Serialize(new[] { $"{invoices.Count} approved invoice{(invoices.Count == 1 ? "" : "s")}", $"Prepared by {actor.Human.Name}" }
                    .Concat(payees.Select(p => $"{p.Name}: {BillingRules.Rand(p.Amount)} to {Payables.Masked(p.BankName, p.AccountNumber)}"))),
                Route = "/finance/payables?view=batches", SourceId = batch.Id,
            };
            batch.ApprovalWorkItemId = item.Id;
            db.PaymentBatches.Add(batch);
            db.WorkItems.Add(item);
            foreach (var inv in invoices)
            {
                inv.Status = "in-batch";
                inv.BatchId = batch.Id;
                inv.Version++;
                await payables.LogOnJobAsync(inv, $"Added to payment batch {batchRef}", actor.Human.Name, ct);
            }
            return Results.Created($"/api/payables/batches/{batch.Id}", new { id = batch.Id.ToString() });
        }, ct);
    }

    /// <summary>
    /// Money leaves the trust account: a passkey (never an SMS code, D26), by someone other than the preparer unless the
    /// agency has nobody else who can (then the approval in My work was the second person). Returns the payment file.
    /// </summary>
    private static async Task<IResult> Release(Guid id, BatchReleaseRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Payables payables,
        IEmailSender email, ILogger<Payables> logger, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await VisibleBatchAsync(me, db, id, ct) is not { } batch) return Problems.NotFound();
        var scheme = await db.Schemes.FirstAsync(s => s.Id == batch.SchemeId, ct);
        var agency = await db.Organisations.FirstAsync(o => o.Id == batch.OrganisationId, ct);
        var payees = Payables.Read(batch);
        var supplierIds = payees.Select(p => Guid.Parse(p.SupplierId)).ToList();
        var suppliers = await db.Suppliers.Where(s => supplierIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        var changed = Payables.ChangedSince(payees, suppliers);
        var preparer = batch.CreatedById == me.Human.Id && await payables.SomeoneElseCanReleaseAsync(batch, me.Human.Id, ct);

        return await commands.RunAsync(new CommandSpec($"Released payment batch {batch.Ref}: {BillingRules.Rand(batch.Total)} to {payees.Count} supplier{(payees.Count == 1 ? "" : "s")} from {scheme.Name}’s trust account", "Payables.Release")
        {
            Resource = "Payment batch",
            ResourceId = id.ToString(),
            SchemeId = batch.SchemeId,
            Category = "security",
            Feature = "payables",
            StepUp = true,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = batch.Version,
            Validate = () =>
                batch.Status != "approved" ? new() { ["status"] = batch.Status == "released" ? "This batch is already released." : "This batch isn’t approved yet." }
                : changed.Count > 0 ? new() { ["status"] = $"Bank details changed after this batch was made, for {string.Join(", ", changed)}: cancel it and prepare a new batch." }
                : [],
        }, async actor =>
        {
            if (preparer) throw new CommandRefused("conflict-of-interest", "You prepared this payment batch: someone else releases it.");
            batch.Status = "released";
            batch.ReleasedAt = payables.Now;
            batch.ReleasedBy = actor.Human.Name;
            batch.Version++;
            var invoiceIds = payees.SelectMany(p => p.InvoiceIds).Select(Guid.Parse).ToList();
            foreach (var inv in await db.SupplierInvoices.Where(i => invoiceIds.Contains(i.Id)).ToListAsync(ct))
            {
                inv.Status = "paid";
                inv.PaidAt = batch.ReleasedAt;
                inv.Version++;
                var payee = payees.First(p => p.InvoiceIds.Contains(inv.Id.ToString()));
                await payables.PaidOnJobAsync(inv, $"Paid {BillingRules.Rand(inv.Amount)} to {payee.Name} (batch {batch.Ref})", actor.Human.Name, ct);
            }
            var paidOn = DateOnly.FromDateTime(payables.Now.ToOffset(TimeSpan.FromHours(2)).DateTime);
            // Remittances go once the release is saved; a failed email never undoes it (docs/26 §8).
            commands.AfterCommit(async () =>
            {
                foreach (var p in payees.Where(p => !string.IsNullOrWhiteSpace(p.Email)))
                {
                    try
                    {
                        await email.SendAsync(Payables.Remittance(p, batch, scheme.Name, agency.Name, paidOn), ct);
                    }
                    catch (Exception e)
                    {
                        logger.LogError(e, "Couldn't email the remittance for {Batch} to {Supplier}", batch.Ref, p.Name);
                    }
                }
            });
            return Results.File(Payables.PaymentFile(batch), "text/csv", Payables.FileName(batch));
        }, ct);
    }

    /// <summary>The payment file again, for a released batch: a passkey, and audited.</summary>
    private static async Task<IResult> PaymentFile(Guid id, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await VisibleBatchAsync(me, db, id, ct) is not { } batch) return Problems.NotFound();
        return await commands.RunAsync(new CommandSpec($"Downloaded the payment file for {batch.Ref}", "Payables.Release")
        {
            Resource = "Export",
            ResourceId = Payables.FileName(batch),
            SchemeId = batch.SchemeId,
            Category = "security",
            Feature = "payables",
            StepUp = true,
            Validate = () => batch.Status != "released" ? new() { ["status"] = "The payment file comes with releasing the batch." } : [],
        }, _ => Task.FromResult(Results.File(Payables.PaymentFile(batch), "text/csv", Payables.FileName(batch))), ct);
    }

    /// <summary>Before release: the batch is withdrawn, its approval closed, and its invoices are ready to pay again.</summary>
    private static async Task<IResult> Cancel(Guid id, BatchCancelRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Payables payables, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await VisibleBatchAsync(me, db, id, ct) is not { } batch) return Problems.NotFound();
        var reason = (body.Reason ?? "").Trim();
        return await commands.RunAsync(new CommandSpec($"Cancelled payment batch {batch.Ref}: {reason}", "Payables.Prepare")
        {
            Resource = "Payment batch",
            ResourceId = id.ToString(),
            SchemeId = batch.SchemeId,
            Feature = "payables",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = batch.Version,
            Validate = () =>
                batch.Status is not ("awaiting-approval" or "approved") ? new() { ["status"] = "Only a batch that isn’t released can be cancelled." }
                : reason.Length < 5 ? new() { ["reason"] = "Say why, for the record." }
                : [],
        }, async actor =>
        {
            if (batch.ApprovalWorkItemId is { } w && await db.WorkItems.FirstOrDefaultAsync(x => x.Id == w && (x.Status == "open" || x.Status == SoleAuthority.HeldStatus), ct) is { } item)
            {
                item.Status = "rejected";
                item.DecidedBy = actor.Human.Name;
                item.DecidedAt = payables.Now;
                item.Comment = $"Batch cancelled: {reason}";
            }
            batch.Status = "cancelled";
            batch.CancelledAt = payables.Now;
            batch.CancelledBy = actor.Human.Name;
            batch.CancelReason = reason;
            batch.Version++;
            await payables.FreeInvoicesAsync(batch, $"Payment batch {batch.Ref} cancelled by {actor.Human.Name}", actor.Human.Name, ct);
            return Results.NoContent();
        }, ct);
    }
}
