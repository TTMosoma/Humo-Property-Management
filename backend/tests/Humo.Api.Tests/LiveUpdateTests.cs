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
