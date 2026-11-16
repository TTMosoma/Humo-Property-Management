using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using Humo.Api.Live;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Live updates (docs/08 §5): an open app hears at once when its bell or work changes, and only the names of what changed.</summary>
public sealed class LiveUpdateTests : IDisposable
{
    private readonly HumoApiFactory api = new();
    private readonly List<HubConnection> connections = [];

    public void Dispose()
    {
        foreach (var c in connections) c.DisposeAsync().AsTask().GetAwaiter().GetResult();
        api.Dispose();
    }

    private static readonly Uri Site = new("https://localhost");

    /// <summary>Signs in and opens the app's live connection with that session's cookie.</summary>
    private async Task<(HttpClient Client, ConcurrentQueue<string[]> Heard)> Open(string email)
    {
        var cookies = new CookieContainerHandler();
        var client = api.CreateDefaultClient(Site, cookies);
        await api.SignedIn(email, client);
        var heard = new ConcurrentQueue<string[]>();
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(Site, UpdatesHub.Path), o =>
            {
                o.HttpMessageHandlerFactory = _ => api.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
                o.Headers["Cookie"] = cookies.Container.GetCookieHeader(Site);
            })
            .Build();
        connection.On<string[]>(UpdatesHub.Changed, topics => heard.Enqueue(topics));
        await connection.StartAsync();
        connections.Add(connection);
        return (client, heard);
    }

    private Task<Guid> Task(Guid org, string title) => api.Db(async db =>
    {
        var row = new WorkItemRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = org, Ref = $"T-{Guid.NewGuid().ToString()[..4]}", Kind = "task", Type = "follow-up", Title = title, Detail = "",
            CreatedAt = api.Clock.GetUtcNow(), DueAt = api.Clock.GetUtcNow().AddDays(2), ApproverRoles = "[]", Evidence = "[]", Route = "/tasks",
        };
        db.WorkItems.Add(row);
        await db.SaveChangesAsync();
        return row.Id;
    });

    [Fact]
    public async Task Work_given_to_someone_reaches_their_open_app_at_once()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var priyaId = await api.Person("priya@acacia.example", Roles.Finance, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var (_, heard) = await Open("priya@acacia.example");
        var task = await Task(org, "Call the auditor");
        heard.Clear();

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync("/api/work-items/assign", new { ids = new[] { task.ToString() }, assigneeId = priyaId.ToString() })).StatusCode);

        await HumoApiFactory.Until(() => heard.SelectMany(t => t).Contains("notifications") && heard.SelectMany(t => t).Contains("work-items"));
        // Names only: the app fetches the notice itself, through the checks.
        Assert.All(heard.SelectMany(t => t), t => Assert.Contains(t, new[] { "notifications", "work-items" }));
    }

    [Fact]
    public async Task Another_agency_hears_nothing()
    {
        var acacia = await api.Customer("Acacia");
        var fynbos = await api.Customer("Fynbos");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, acacia);
        var priyaId = await api.Person("priya@acacia.example", Roles.Finance, acacia);
        await api.Person("anele@fynbos.example", Roles.Finance, fynbos);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var (_, priya) = await Open("priya@acacia.example");
        var (_, other) = await Open("anele@fynbos.example");
        var task = await Task(acacia, "Call the auditor");
        priya.Clear();
        other.Clear();

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync("/api/work-items/assign", new { ids = new[] { task.ToString() }, assigneeId = priyaId.ToString() })).StatusCode);

        await HumoApiFactory.Until(() => priya.SelectMany(t => t).Contains("notifications"));
        Assert.Empty(other);
    }

    private async Task Passkey(Guid userId)
    {
        using var scope = api.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<HumoUser>>();
        var user = (await users.FindByIdAsync(userId.ToString()))!;
        var info = new UserPasskeyInfo(Guid.NewGuid().ToByteArray(), [1, 2, 3], api.Clock.GetUtcNow(), 0, null, true, true, false, [1], [1]) { Name = "Phone" };
        Assert.True((await users.AddOrUpdatePasskeyAsync(user, info)).Succeeded);
    }

    [Fact]
    public async Task Removing_someones_passkeys_signs_them_out_at_once_and_their_open_app_hears_it()
    {
        var org = await api.Customer("Acacia");
        var thandeka = await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        await Passkey(thandeka);
        await api.Person("lerato@humo.co.za", Roles.Support, null);
        var support = await api.SignedIn("lerato@humo.co.za");
        await support.StepUp();
        var (client, heard) = await Open("thandeka@acacia.example");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me")).StatusCode);
        heard.Clear();

        Assert.Equal(HttpStatusCode.NoContent,
            (await support.PostAsJsonAsync($"/api/platform/users/{thandeka}/passkeys/remove", new { reason = "Lost phone, confirmed by a call to their office" })).StatusCode);

        await HumoApiFactory.Until(() => heard.SelectMany(t => t).Contains("session"));
        // No waiting for the cookie's 5-minute check: the very next request is refused.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Signing_out_everywhere_else_tells_the_other_open_apps()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var (laptop, laptopHeard) = await Open("thandeka@acacia.example");
        var here = await api.SignedIn("thandeka@acacia.example");
        await here.StepUp();
        laptopHeard.Clear();

        Assert.Equal(HttpStatusCode.NoContent, (await here.PostAsync("/api/me/security/sign-out-others", null)).StatusCode);

        await HumoApiFactory.Until(() => laptopHeard.SelectMany(t => t).Contains("session"));
        Assert.Equal(HttpStatusCode.Unauthorized, (await laptop.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await here.GetAsync("/api/me")).StatusCode);
    }

    /// <summary>Acacia with Kingfisher Court: Thandeka (admin), Johan (portfolio manager), and two owners in different units.</summary>
    private async Task<(Guid Org, HttpClient Admin)> Residents()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = Guid.Parse((await (await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" })).Json()).GetProperty("id").GetString()!);
        await api.Person("johan@acacia.example", Roles.PortfolioManager, org, [kc]);
        foreach (var (number, first, email) in new[] { ("42", "Sipho", "sipho@mail.example"), ("12", "Lindiwe", "lindiwe@mail.example") })
        {
            var unit = Guid.Parse((await (await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number, description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1800, occupancy = "owner-occupied" })).Json()).GetProperty("id").GetString()!);
            await admin.PostAsJsonAsync("/api/people", new
            {
                details = new { firstName = first, lastName = "Owner", kind = "individual", email, phone = "083 551 0274", preferredChannel = "email" },
                link = new { type = "owner", schemeId = kc.ToString(), unitId = unit.ToString(), since = "2019-05-01" },
            });
            var user = await api.Person(email, Roles.Owner, org, [kc]);
            await api.Db(async db =>
            {
                (await db.Users.SingleAsync(u => u.Id == user)).PersonId = (await db.People.SingleAsync(p => p.Email == email)).Id.ToString();
                foreach (var a in await db.RoleAssignments.Where(a => a.UserId == user).ToListAsync()) a.UnitId = unit.ToString();
                return await db.SaveChangesAsync();
            });
        }
        return (org, admin);
    }

    [Fact]
    public async Task A_change_to_a_job_reaches_the_agencys_open_pages_and_its_residents_but_not_their_neighbours()
    {
        var (org, admin) = await Residents();
        var (_, johan) = await Open("johan@acacia.example");
        var (sipho, siphoHeard) = await Open("sipho@mail.example");
        var (_, lindiweHeard) = await Open("lindiwe@mail.example");

        var reported = await sipho.PostAsJsonAsync("/api/jobs", new { title = "Geyser leaking", description = "Dripping since this morning.", category = "Plumbing" });
        Assert.Equal(HttpStatusCode.Created, reported.StatusCode);
        var reference = (await reported.Json()).GetProperty("id").GetString();
        await HumoApiFactory.Until(() => johan.SelectMany(t => t).Contains("jobs") && siphoHeard.SelectMany(t => t).Contains("jobs"));
        johan.Clear();
        siphoHeard.Clear();

        // Thandeka moves it on while Johan has it open: his page hears at once, and so does Sipho's.
        var version = (await (await admin.GetAsync($"/api/jobs/{reference}")).Json()).GetProperty("job").GetProperty("version").GetInt32();
        var cancelled = await admin.PostAsJsonAsync($"/api/jobs/{reference}/actions", new { action = new { type = "cancel", reason = "Duplicate of an earlier request" }, expectedVersion = version });
        Assert.Equal(HttpStatusCode.NoContent, cancelled.StatusCode);
        await HumoApiFactory.Until(() => johan.SelectMany(t => t).Contains("jobs") && siphoHeard.SelectMany(t => t).Contains("jobs"));

        // Lindiwe, in another unit, hears nothing about Sipho's request, nor the agency's own work.
        Assert.DoesNotContain("jobs", lindiweHeard.SelectMany(t => t));
        Assert.DoesNotContain("work-items", lindiweHeard.SelectMany(t => t));
    }

    [Fact]
    public async Task A_residents_message_reaches_the_agencys_open_inbox()
    {
        await Residents();
        var (_, johan) = await Open("johan@acacia.example");
        var (sipho, _) = await Open("sipho@mail.example");

        var sent = await sipho.PostAsJsonAsync("/api/me/conversations", new { subject = "Leaking geyser", body = "Water is coming through my ceiling from the unit above." });
        Assert.Equal(HttpStatusCode.Created, sent.StatusCode);

        await HumoApiFactory.Until(() => johan.SelectMany(t => t).Contains("inbox"));
    }

    [Fact]
    public async Task Nobody_connects_without_signing_in()
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(Site, UpdatesHub.Path), o =>
            {
                o.HttpMessageHandlerFactory = _ => api.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
            })
            .Build();
        connections.Add(connection);

        var refused = await Assert.ThrowsAsync<HttpRequestException>(() => connection.StartAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);
    }
}
