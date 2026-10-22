using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Basic invoicing on the Essentials package (D17): issuing, payments by hand, and sending to the owner.</summary>
public sealed class OwnerInvoiceTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(HttpClient Admin, Guid Org, Guid Account);

    /// <summary>An Essentials agency with one unit and its owner, who has an email address on record.</summary>
    private async Task<Setup> Essentials(string? ownerEmail = "owner@mail.example")
    {
        var org = await api.Customer("Acacia", "essentials");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var scheme = Guid.Parse((await (await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" })).Json()).GetProperty("id").GetString()!);
        var unit = Guid.Parse((await (await admin.PostAsJsonAsync($"/api/schemes/{scheme}/units", new { number = "42", description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1800, occupancy = "owner-occupied" })).Json()).GetProperty("id").GetString()!);
        var account = await api.Db(db => db.LevyAccounts.Where(a => a.UnitId == unit).Select(a => a.Id).SingleAsync());
        if (ownerEmail is not null)
            await api.Db(async db =>
            {
                var person = Guid.CreateVersion7();
                db.People.Add(new Person { Id = person, OrganisationId = org, FirstName = "Sipho", LastName = "Khumalo", Kind = "individual", DisplayName = "Sipho Khumalo", Initials = "SK", Email = ownerEmail, Phone = "", PreferredChannel = "email", CreatedAt = DateTimeOffset.UtcNow });
                db.Relationships.Add(new Relationship { Id = Guid.CreateVersion7(), PersonId = person, Type = "owner", SchemeId = scheme, UnitId = unit, Since = new DateOnly(2020, 1, 1) });
                (await db.LevyAccounts.SingleAsync(a => a.UnitId == unit)).HolderPersonId = person; // the account holder gets the statement
                return await db.SaveChangesAsync();
            });
        return new Setup(admin, org, account);
    }

    private static object Invoice(Guid account, params (string Description, decimal Quantity, decimal Price)[] lines) => new
    {
        accountId = account.ToString(), date = "2026-10-22", dueOn = "2026-11-21",
        lines = lines.Select(l => new { description = l.Description, quantity = l.Quantity, unitPrice = l.Price }),
    };

    private async Task<decimal> Balance(Guid account) => await api.Db(db => db.Ledger.Where(e => e.AccountId == account).SumAsync(e => e.Amount));

    [Fact]
    public async Task An_invoice_is_numbered_and_charged_to_the_owners_account()
    {
        var s = await Essentials();
        var res = await s.Admin.PostAsJsonAsync("/api/owner-invoices", Invoice(s.Account, ("Garden service", 2, 150), ("Gate remote", 1, 80)));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var created = await res.Json();
        Assert.Equal("INV-0001", created.GetProperty("number").GetString());

        var invoice = await (await s.Admin.GetAsync($"/api/owner-invoices/{created.GetProperty("id").GetString()}")).Json();
        Assert.Equal((380m, 380m, "issued"), (invoice.GetProperty("total").GetDecimal(), invoice.GetProperty("outstanding").GetDecimal(), invoice.GetProperty("status").GetString()));
        Assert.Equal(380m, await Balance(s.Account));
    }

    [Fact]
    public async Task An_invoice_needs_an_account_a_total_and_sensible_dates()
    {
        var s = await Essentials();
        var none = await s.Admin.PostAsJsonAsync("/api/owner-invoices", new { accountId = Guid.NewGuid().ToString(), lines = Array.Empty<object>() });
        var errors = await none.FieldErrors();
        Assert.Equal(("Choose the owner’s account to invoice.", "Add at least one line."), (errors.GetProperty("accountId").GetString(), errors.GetProperty("lines").GetString()));

        var zero = await s.Admin.PostAsJsonAsync("/api/owner-invoices", Invoice(s.Account, ("Nothing", 1, 0)));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, zero.StatusCode);
        Assert.Equal(0m, await Balance(s.Account));
    }

    [Fact]
    public async Task Payments_are_recorded_by_hand_up_to_what_is_owed_and_mark_the_invoice_paid()
    {
        var s = await Essentials();
        var id = (await (await s.Admin.PostAsJsonAsync("/api/owner-invoices", Invoice(s.Account, ("Garden service", 2, 150)))).Json()).GetProperty("id").GetString()!;

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/owner-invoices/{id}/payments", new { amount = 100, date = "2026-10-25", reference = "EFT 4471" })).StatusCode);
        var partly = await (await s.Admin.GetAsync($"/api/owner-invoices/{id}")).Json();
        Assert.Equal(("issued", 200m), (partly.GetProperty("status").GetString(), partly.GetProperty("outstanding").GetDecimal()));

        var over = await s.Admin.PostAsJsonAsync($"/api/owner-invoices/{id}/payments", new { amount = 250, date = "2026-10-26" });
        Assert.Contains("Only 200.00 is still owed", (await over.FieldErrors()).GetProperty("amount").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/owner-invoices/{id}/payments", new { amount = 200, date = "2026-10-27" })).StatusCode);
        Assert.Equal("paid", (await (await s.Admin.GetAsync($"/api/owner-invoices/{id}")).Json()).GetProperty("status").GetString());
        Assert.Equal(0m, await Balance(s.Account));
    }

    [Fact]
    public async Task The_invoice_is_emailed_to_the_owner_on_record()
    {
        var s = await Essentials();
        var id = (await (await s.Admin.PostAsJsonAsync("/api/owner-invoices", Invoice(s.Account, ("Garden service", 2, 150)))).Json()).GetProperty("id").GetString()!;
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsync($"/api/owner-invoices/{id}/send", null)).StatusCode);
        var mail = Assert.Single(api.Email.Sent);
        Assert.Equal(("owner@mail.example", "Invoice INV-0001"), (mail.To, mail.Subject));
        Assert.Contains("Total: 300.00", mail.Text);
    }

    [Fact]
    public async Task An_owner_with_no_email_address_cannot_be_sent_an_invoice()
    {
        var s = await Essentials(ownerEmail: null);
        var id = (await (await s.Admin.PostAsJsonAsync("/api/owner-invoices", Invoice(s.Account, ("Garden service", 1, 150)))).Json()).GetProperty("id").GetString()!;
        var res = await s.Admin.PostAsync($"/api/owner-invoices/{id}/send", null);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.Empty(api.Email.Sent);
    }

    [Fact]
    public async Task An_essentials_agency_sends_one_owner_a_statement_on_demand_including_the_invoice()
    {
        // No billing run: the statement is issued when it's sent, and the invoice's charge is on the statement.
        var s = await Essentials();
        // Statements tell owners where to pay: the scheme's trust account comes first.
        var scheme = await api.Db(db => db.LevyAccounts.Where(a => a.Id == s.Account).Select(a => a.SchemeId).SingleAsync());
        await s.Admin.StepUp();
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PutAsJsonAsync($"/api/settings/trust-accounts/{scheme}",
            new { bank = "FNB", accountName = "Kingfisher Court Body Corporate", accountNumber = "6234 5678 901", branchCode = "250655" })).StatusCode);
        await s.Admin.PostAsJsonAsync("/api/owner-invoices", Invoice(s.Account, ("Garden service", 2, 150)));
        var sent = await s.Admin.PostAsync($"/api/accounts/{s.Account}/statements/2026-10/send", null);
        Assert.True(sent.StatusCode == HttpStatusCode.OK, await sent.Content.ReadAsStringAsync());
        await HumoApiFactory.Until(() => !api.Email.Sent.IsEmpty);
        Assert.Equal("owner@mail.example", Assert.Single(api.Email.Sent).To);
    }
}
