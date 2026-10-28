using System.Net;
using Humo.Api.Startup;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace Humo.Api.Tests;

/// <summary>The development seed (docs/28 §1): demo agencies through the API's own services, Development only.</summary>
public sealed class DevSeedTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed class Env(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "Humo.Api";
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    [Fact]
    public async Task The_seed_loads_working_demo_agencies_once_and_only_in_development()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => DevSeed.RunAsync(api.Services, new Env(Environments.Production)));

        var report = await DevSeed.RunAsync(api.Services, new Env(Environments.Development));
        Assert.Contains("thandeka@acacia.example", report);
        // Levies and payments through the ledger: some accounts are paid up, some in arrears.
        var balances = await api.Db(db => db.LevyAccounts.Select(a => a.Balance).ToListAsync());
        Assert.Contains(balances, b => b > 0);
        Assert.Contains(balances, b => b <= 0);

        // The seeded people work: the administrator sees the schemes, the owner their account.
        var admin = await api.SignedIn("thandeka@acacia.example");
        var schemes = await (await admin.GetAsync("/api/schemes")).Json();
        Assert.Equal(2, schemes.GetArrayLength());
        var owner = await api.SignedIn("anele@mail.example");
        var kc42 = await api.Db(db => db.LevyAccounts.Where(a => a.AccountNo.StartsWith("KC") && a.AccountNo.EndsWith("42")).Select(a => a.Id).SingleAsync());
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync($"/api/accounts/{kc42}")).StatusCode);
        // Suppliers to pay (slice 3b): approved invoices, and one bank account waiting for someone else to verify it.
        var invoices = await (await admin.GetAsync($"/api/payables/invoices?schemeIds={schemes[0].GetProperty("id").GetString()}&schemeIds={schemes[1].GetProperty("id").GetString()}")).Json();
        Assert.Equal(4, invoices.GetArrayLength());
        Assert.Equal(1, await api.Db(db => db.WorkItems.CountAsync(w => w.Type == "bank-details-verification" && w.Status == "open")));
        // Agencies don't see each other.
        var fynbos = await api.SignedIn("annette@fynbos.example");
        Assert.Equal(HttpStatusCode.NotFound, (await fynbos.GetAsync($"/api/accounts/{kc42}")).StatusCode);

        // Again: nothing changes.
        var units = await api.Db(db => db.Units.CountAsync());
        Assert.Contains("already there", await DevSeed.RunAsync(api.Services, new Env(Environments.Development)));
        Assert.Equal(units, await api.Db(db => db.Units.CountAsync()));
    }
}
