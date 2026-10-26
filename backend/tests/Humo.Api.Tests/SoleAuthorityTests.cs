using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Humo.Api.Work;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Api.Tests;

/// <summary>Approving with one authoriser (D24): a trustee on Humo first; otherwise alone, under the trustees' permission, after a cooling-off.</summary>
public sealed class SoleAuthorityTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

    private sealed record Setup(Guid Org, Guid Kc, Guid Sipho, HttpClient Admin, Guid AdminId);

    /// <summary>Acacia with one member of staff (Thandeka, the administrator) and Kingfisher Court, where Sipho owns unit 42 and is a trustee on the board register.</summary>
    private async Task<Setup> OneAuthoriser()
    {
        var org = await api.Customer("Acacia", "professional");
        var adminId = await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var u42 = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "42", description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1850, occupancy = "owner-occupied" }));
        var sipho = await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Sipho", lastName = "Khumalo", kind = "individual", email = "sipho@mail.example", phone = "083 551 0274", preferredChannel = "email" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = u42.ToString(), since = "2019-05-01" },
        }));
        // On the board register, without a Humo sign-in.
        await api.Db(async db =>
        {
            db.Relationships.Add(new Relationship { Id = Guid.CreateVersion7(), PersonId = sipho, SchemeId = kc, Type = "trustee", Since = new DateOnly(2026, 3, 1) });
            return await db.SaveChangesAsync();
        });
        return new Setup(org, kc, sipho, admin, adminId);
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static async Task NoContent(HttpResponseMessage res) =>
        Assert.True(res.StatusCode == HttpStatusCode.NoContent, $"{res.StatusCode}: {await res.Content.ReadAsStringAsync()}");

    /// <summary>November's billing run, prepared by the administrator and sent for approval. Returns the run id.</summary>
    private static async Task<Guid> RunAwaitingApproval(Setup s)
    {
        var id = await Id(await s.Admin.PostAsJsonAsync("/api/billing/runs", new { schemeId = s.Kc.ToString(), period = "2026-11" }));
        var run = (await (await s.Admin.GetAsync($"/api/billing/runs/{id}")).Json()).GetProperty("run");
        var v = 1;
        foreach (var e in run.GetProperty("exceptions").EnumerateArray())
            await NoContent(await s.Admin.PostAsJsonAsync($"/api/billing/runs/{id}/actions",
                new { action = new { type = "decide", exceptionId = e.GetProperty("id").GetString(), decision = e.GetProperty("options")[0].GetString() }, expectedVersion = v++ }));
        await NoContent(await s.Admin.PostAsJsonAsync($"/api/billing/runs/{id}/actions", new { action = new { type = "send-for-approval" }, expectedVersion = v }));
        return id;
    }

    private static async Task<JsonElement> Approval(HttpClient c) =>
        (await (await c.GetAsync("/api/work-items")).Json()).EnumerateArray().Single(w => w.GetProperty("kind").GetString() == "approval");

    private static Task<HttpResponseMessage> AddPermission(Setup s, string summary = "Resolution of 1 October 2026, signed by Sipho Khumalo and Lindiwe Mokoena")
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(s.Kc.ToString()), "schemeId" },
            { new StringContent(summary), "summary" },
            { new StringContent("2026-10-01"), "grantedOn" },
        };
        var file = new ByteArrayContent(Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        form.Add(file, "file", "trustee-resolution.pdf");
        return s.Admin.PostAsync("/api/trustee-permissions", form);
    }

    private Task<string> RunStage(Guid run) => api.Db(db => db.BillingRuns.Where(r => r.Id == run).Select(r => r.Stage).SingleAsync());

    [Fact]
    public async Task With_no_trustee_on_Humo_the_only_approver_approves_alone_under_the_trustees_permission_after_a_cooling_off()
    {
        var s = await OneAuthoriser();
        var run = await RunAwaitingApproval(s);

        // Nobody else can approve, and no trustee is on Humo: the trustees' permission comes first.
        var item = await Approval(s.Admin);
        Assert.Equal("permission-needed", item.GetProperty("secondAuthoriser").GetProperty("mode").GetString());
        var id = item.GetProperty("id").GetString();
        Assert.Equal("conflict-of-interest", await (await s.Admin.PostAsJsonAsync($"/api/work-items/{id}/decision", new { decision = "approved", alone = true })).ProblemCode());

        // The signed permission, with a fresh passkey.
        Assert.Equal("step-up-required", await (await AddPermission(s)).ProblemCode());
        await s.Admin.StepUp();
        Assert.True((await (await AddPermission(s, "Yes")).FieldErrors()).TryGetProperty("summary", out _));
        await Id(await AddPermission(s));
        var schemes = await (await s.Admin.GetAsync("/api/trustee-permissions")).Json();
        var kc = schemes.EnumerateArray().Single();
        Assert.Equal((0, true, "2027-10-01"), (kc.GetProperty("trusteesOnHumo").GetInt32(), kc.GetProperty("permission").GetProperty("inForce").GetBoolean(),
            kc.GetProperty("permission").GetProperty("until").GetString()));

        // Approving alone: held for 24 hours, not in force yet.
        Assert.Equal("alone", (await Approval(s.Admin)).GetProperty("secondAuthoriser").GetProperty("mode").GetString());
        Assert.Equal("conflict-of-interest", await (await s.Admin.PostAsJsonAsync($"/api/work-items/{id}/decision", new { decision = "approved" })).ProblemCode());
        await NoContent(await s.Admin.PostAsJsonAsync($"/api/work-items/{id}/decision", new { decision = "approved", alone = true }));
        var held = await Approval(s.Admin);
        Assert.Equal(("cooling-off", "thandeka"), (held.GetProperty("status").GetString(), held.GetProperty("heldBy").GetString()));
        Assert.Equal("awaiting-approval", await RunStage(run));
        Assert.Contains(await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync()), a => a.StartsWith("Approved alone under the trustees’ permission (D24)"));

        // Before the cooling-off ends, nothing happens.
        await Release();
        Assert.Equal("awaiting-approval", await RunStage(run));

        // After 24 hours: in effect; the approver and the trustees on record are told.
        api.Email.Sent.Clear();
        api.Clock.Advance(TimeSpan.FromHours(25));
        await Release();
        Assert.Equal("approved", await RunStage(run));
        Assert.Equal("approved", await api.Db(db => db.WorkItems.Where(w => w.Kind == "approval").Select(w => w.Status).SingleAsync()));
        Assert.Contains(await api.Db(db => db.Notices.Where(n => n.ToIdentityId == s.AdminId).Select(n => n.Title).ToListAsync()), t => t.StartsWith("In effect:"));
        Assert.Contains(api.Email.Sent, e => e.To == "sipho@mail.example" && e.Subject.StartsWith("Approved on the board’s behalf"));
        Assert.Contains(api.Email.Sent, e => e.To == "thandeka@acacia.example" && e.Subject.StartsWith("In effect:"));
        Assert.Contains(await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync()), a => a.Contains("took effect after the cooling-off"));
    }

    [Fact]
    public async Task A_trustee_on_Humo_approves_instead_and_the_permission_isnt_needed()
    {
        var s = await OneAuthoriser();
        await api.Person("lindiwe@mail.example", Roles.Trustee, s.Org, [s.Kc]);
        var run = await RunAwaitingApproval(s);

        Assert.Equal("trustees", (await Approval(s.Admin)).GetProperty("secondAuthoriser").GetProperty("mode").GetString());
        await s.Admin.StepUp();
        Assert.True((await (await AddPermission(s)).FieldErrors()).TryGetProperty("schemeId", out _));

        var trustee = await api.SignedIn("lindiwe@mail.example");
        var id = (await Approval(trustee)).GetProperty("id").GetString();
        await NoContent(await trustee.PostAsJsonAsync($"/api/work-items/{id}/decision", new { decision = "approved" }));
        Assert.Equal("approved", await RunStage(run));
    }

    [Fact]
    public async Task An_approval_in_its_cooling_off_can_be_stopped()
    {
        var s = await OneAuthoriser();
        var run = await RunAwaitingApproval(s);
        await s.Admin.StepUp();
        await Id(await AddPermission(s));
        var id = (await Approval(s.Admin)).GetProperty("id").GetString();
        await NoContent(await s.Admin.PostAsJsonAsync($"/api/work-items/{id}/decision", new { decision = "approved", alone = true }));

        await NoContent(await s.Admin.PostAsync($"/api/work-items/{id}/cancel-hold", null));
        Assert.Equal("open", (await Approval(s.Admin)).GetProperty("status").GetString());
        api.Clock.Advance(TimeSpan.FromHours(25));
        await Release();
        Assert.Equal("awaiting-approval", await RunStage(run));
    }

    private async Task Release()
    {
        await using var scope = api.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<SoleAuthority>().ReleaseDueAsync(CancellationToken.None);
    }
}
