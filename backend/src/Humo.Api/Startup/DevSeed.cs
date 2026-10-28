using Humo.Api.Finance;
using Humo.Api.Portfolio;
using Humo.Domain.Access;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Startup;

/// <summary>
/// A development seed (docs/28 §1): `dotnet run --project src/Humo.Api -- seed-demo` loads two demo agencies into a local
/// database, so the live system can be tried screen by screen instead of starting empty. Development only: it refuses
/// anywhere else, and never runs by itself. It uses the same services as the endpoints (the plan's trial, the levy
/// ledger), so balances, ageing and statuses come out as they would in use. Run it again and it changes nothing.
///
/// Everyone signs in by email link; with the dev services running, the emails land in Mailpit (http://localhost:8025).
/// </summary>
public static class DevSeed
{
    public const string Command = "seed-demo";

    private sealed record UnitSeed(string Number, string Description, int SizeM2, decimal Quota, decimal Levy, string Owner, string Email, string Phone, string Pays = "on-time",
        string? Tenant = null);

    private sealed record SchemeSeed(string Name, string Code, string Suburb, string City, string Province, string Bank, string AccountNumber, string Branch, UnitSeed[] Units,
        string[] Trustees);

    private sealed record StaffSeed(string Name, string Email, string Role, string? SchemeCode = null);

    private sealed record AgencySeed(string Name, string ShortName, string City, string Province, string Package, StaffSeed[] Staff, SchemeSeed[] Schemes,
        (string Email, string[] Units)[] OwnerLogins);

    private static readonly AgencySeed[] Agencies =
    [
        new("Acacia Managing Agents (Pty) Ltd", "Acacia", "Sandton", "Gauteng", "professional",
            [
                new("Thandeka Nkosi", "thandeka@acacia.example", Roles.AgencyAdmin),
                new("Priya Naidoo", "priya@acacia.example", Roles.Finance),
                new("Johan van der Merwe", "johan@acacia.example", Roles.PortfolioManager, "KC"),
            ],
            [
                new("Kingfisher Court", "KC", "Morningside", "Sandton", "Gauteng", "First National Bank", "62052269861", "250655",
                [
                    new("12", "3-bed, 2-bath", 120, 2.00m, 2400, "Sipho Khumalo", "sipho@mail.example", "083 551 0274"),
                    new("14", "2-bed", 86, 1.25m, 1850, "Nadia Abrahams", "nadia@mail.example", "082 410 3367", Tenant: "Kabelo Molefe"),
                    new("21", "2-bed", 86, 1.25m, 1850, "Lindiwe Zulu", "lindiwe@mail.example", "071 220 9184", Pays: "arrears"),
                    new("23", "1-bed", 58, 0.85m, 1450, "Pieter Botha", "pieter@mail.example", "084 662 1043"),
                    new("31", "2-bed", 92, 1.35m, 1980, "Ayesha Patel", "ayesha@mail.example", "072 334 8851", Pays: "partly"),
                    new("33", "3-bed", 124, 2.05m, 2480, "Michael Smith", "michael@mail.example", "082 901 2276", Tenant: "Zanele Dlamini"),
                    new("42", "2-bed, garden", 86, 1.25m, 3480, "Anele Mthembu", "anele@mail.example", "083 555 0101"),
                    new("44", "2-bed", 86, 1.25m, 1850, "Grace Mokoena", "grace@mail.example", "076 118 4420", Pays: "arrears"),
                ],
                ["Sipho Khumalo", "Pieter Botha", "Ayesha Patel"]),
                new("Die Eike", "DE", "Stellenbosch Central", "Stellenbosch", "Western Cape", "Standard Bank", "07255533381", "051001",
                [
                    new("3", "Studio", 42, 0.70m, 1250, "Marike du Toit", "marike@mail.example", "082 556 7710"),
                    new("5", "1-bed", 55, 0.90m, 1500, "Thabo Mabaso", "thabo@mail.example", "073 405 2219", Tenant: "Lerato Sithole"),
                    new("7", "2-bed", 78, 1.20m, 2100, "Anele Mthembu", "anele@mail.example", "083 555 0101"),
                    new("9", "2-bed", 80, 1.25m, 2150, "Johanna Visser", "johanna@mail.example", "084 990 3346", Pays: "arrears"),
                ],
                ["Marike du Toit", "Johanna Visser"]),
            ],
            [("anele@mail.example", ["KC 42", "DE 7"])]),
        new("Fynbos Property Administrators (Pty) Ltd", "Fynbos", "Cape Town", "Western Cape", "essentials",
            [new("Annette Jacobs", "annette@fynbos.example", Roles.AgencyAdmin)],
            [
                new("Protea Gardens", "PG", "Rondebosch", "Cape Town", "Western Cape", "Nedbank", "11987654321", "198765",
                [
                    new("1", "2-bed", 80, 2.50m, 1650, "Fatima Isaacs", "fatima@mail.example", "082 777 1201"),
                    new("2", "2-bed", 80, 2.50m, 1650, "Willem Joubert", "willem@mail.example", "083 777 1202", Pays: "arrears"),
                    new("3", "3-bed", 110, 3.40m, 2250, "Nomvula Ndlovu", "nomvula@mail.example", "072 777 1203"),
                ],
                ["Fatima Isaacs"]),
            ],
            []),
    ];

    /// <summary>Loads the demo agencies. Returns what it did, for the console.</summary>
    public static async Task<string> RunAsync(IServiceProvider services, IHostEnvironment env, CancellationToken ct = default)
    {
        if (!env.IsDevelopment())
            throw new InvalidOperationException($"{Command} runs only with ASPNETCORE_ENVIRONMENT=Development: it adds demo agencies and people.");
        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<HumoDbContext>();
        var users = sp.GetRequiredService<UserManager<HumoUser>>();
        var ledger = sp.GetRequiredService<AccountLedger>();
        var records = sp.GetRequiredService<Commercial.CommercialRecords>();
        var clock = sp.GetRequiredService<TimeProvider>();
        var now = clock.GetUtcNow();
        var report = new List<string>();

        foreach (var a in Agencies)
        {
            if (await db.Organisations.AnyAsync(o => o.ShortName == a.ShortName, ct))
            {
                report.Add($"{a.ShortName}: already there, left as it is.");
                continue;
            }
            var org = new Organisation
            {
                Id = Guid.CreateVersion7(), Name = a.Name, ShortName = a.ShortName, City = a.City, Province = a.Province, Status = OrganisationStatuses.Active,
                TrialPackageId = a.Package, CreatedAt = now,
            };
            db.Organisations.Add(org);
            await records.OpenAsync(org, a.Package, null, ct);

            var schemes = new Dictionary<string, Scheme>();
            var units = new Dictionary<string, (Unit Unit, LevyAccount Account)>();
            var people = new Dictionary<string, Person>();
            foreach (var s in a.Schemes)
            {
                var scheme = new Scheme
                {
                    Id = Guid.CreateVersion7(), OrganisationId = org.Id, Name = s.Name, Code = s.Code, Suburb = s.Suburb, City = s.City, Province = s.Province, Status = "active",
                    CreatedAt = now,
                };
                db.Schemes.Add(scheme);
                schemes[s.Code] = scheme;
                db.TrustAccounts.Add(new TrustAccountRow
                {
                    SchemeId = scheme.Id, Bank = s.Bank, AccountName = $"{s.Name} Body Corporate", AccountNumber = s.AccountNumber, BranchCode = s.Branch, Verified = true,
                    UpdatedBy = "Development seed", UpdatedAt = now,
                });
                foreach (var u in s.Units)
                {
                    var accountNo = UnitEndpoints.AccountNumber(s.Code, u.Number);
                    var unit = new Unit
                    {
                        Id = Guid.CreateVersion7(), SchemeId = scheme.Id, Number = u.Number, AccountNo = accountNo, Description = u.Description, SizeM2 = u.SizeM2,
                        ParticipationQuota = u.Quota, MonthlyLevy = u.Levy, Occupancy = u.Tenant is null ? "owner-occupied" : "tenanted", CreatedAt = now,
                    };
                    var person = PersonFor(db, people, org.Id, u.Owner, u.Email, u.Phone, now);
                    var account = new LevyAccount { Id = Guid.CreateVersion7(), UnitId = unit.Id, SchemeId = scheme.Id, AccountNo = accountNo, HolderPersonId = person.Id };
                    db.Units.Add(unit);
                    db.LevyAccounts.Add(account);
                    units[$"{s.Code} {u.Number}"] = (unit, account);
                    db.Relationships.Add(new Relationship { Id = Guid.CreateVersion7(), PersonId = person.Id, Type = "owner", SchemeId = scheme.Id, UnitId = unit.Id, Since = new DateOnly(2019, 3, 1) });
                    if (u.Tenant is { } tenant)
                    {
                        var t = PersonFor(db, people, org.Id, tenant, $"{tenant.Split(' ')[0].ToLowerInvariant()}@mail.example", "", now);
                        db.Relationships.Add(new Relationship { Id = Guid.CreateVersion7(), PersonId = t.Id, Type = "tenant", SchemeId = scheme.Id, UnitId = unit.Id, Since = new DateOnly(2025, 2, 1) });
                    }
                }
                // The board register (D2): trustee access comes from here.
                foreach (var name in s.Trustees)
                    db.Relationships.Add(new Relationship
                    {
                        Id = Guid.CreateVersion7(), PersonId = people[name].Id, Type = "trustee", SchemeId = scheme.Id, Portfolio = name == s.Trustees[0] ? "Chairperson" : null,
                        Since = new DateOnly(2024, 6, 1), AppointmentHow = "Elected at the AGM",
                    });
            }
            await db.SaveChangesAsync(ct);

            // Three months of levies; most owners pay on time, some are in arrears.
            var today = ledger.Today;
            var first = new DateOnly(today.Year, today.Month, 1).AddMonths(-2);
            foreach (var s in a.Schemes)
                foreach (var u in s.Units)
                {
                    var (_, account) = units[$"{s.Code} {u.Number}"];
                    for (var month = first; month <= today; month = month.AddMonths(1))
                    {
                        await ledger.PostAsync(account, month, TransactionTypes.Levy, $"Levy — {month:MMMM}", u.Levy, "Development seed", ct: ct);
                        var paidOn = month.AddDays(4);
                        var pays = u.Pays == "on-time" || (u.Pays == "partly" && month < today.AddDays(-today.Day + 1));
                        if (!pays || paidOn > today) continue;
                        var amount = u.Pays == "partly" ? Math.Round(u.Levy / 2, 2) : u.Levy;
                        var receipt = new Receipt
                        {
                            Id = Guid.CreateVersion7(), SchemeId = schemes[s.Code].Id, BankAccount = $"{s.Bank} ····{s.AccountNumber[^4..]}", Date = paidOn, Amount = amount,
                            Reference = account.AccountNo, Payer = u.Owner.ToUpperInvariant(), Status = "allocated", AllocatedBy = "Development seed", AutoMatched = true,
                            Source = "statement-import", CapturedBy = "Development seed", CreatedAt = now,
                        };
                        db.Receipts.Add(receipt);
                        db.ReceiptAllocations.Add(new ReceiptAllocation { ReceiptId = receipt.Id, AccountId = account.Id, Amount = amount });
                        await ledger.PostAsync(account, paidOn, TransactionTypes.Payment, "Payment received — thank you", -amount, "Development seed", account.AccountNo, receipt.Id, ct);
                    }
                }

            // Staff, and the owners who sign in to the portal.
            foreach (var s in a.Staff)
            {
                var schemeScope = s.SchemeCode is { } code ? [schemes[code].Id.ToString()] : new List<string>();
                await UserAsync(db, users, org.Id, s.Name, s.Email, null, [(s.Role, schemeScope.Count > 0 ? ScopeTypes.Schemes : ScopeTypes.Organisation, schemeScope, null)], now);
                report.Add($"{a.ShortName}: {s.Email} ({RoleLabel(s.Role)})");
            }
            foreach (var (email, owned) in a.OwnerLogins)
            {
                var person = people.Values.First(p => p.Email == email);
                await UserAsync(db, users, org.Id, person.DisplayName, email, person.Id,
                    owned.Select(k => (Roles.Owner, ScopeTypes.Unit, new List<string> { units[k].Unit.SchemeId.ToString() }, (string?)units[k].Unit.Id.ToString())).ToList(), now);
                report.Add($"{a.ShortName}: {email} (Owner of {string.Join(" and ", owned)})");
            }
            db.Notes.Add(new NoteRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = org.Id, UnitId = units.Values.First().Unit.Id, Kind = "call", Text = "Owner called about the water meter reading. Promised a reading this week.",
                Author = a.Staff[0].Name, At = now.AddDays(-3),
            });
            await db.SaveChangesAsync(ct);
            report.Add($"{a.ShortName}: {a.Schemes.Length} scheme(s), {a.Schemes.Sum(s => s.Units.Length)} units, {people.Count} people, three months of levies.");
        }
        return string.Join(Environment.NewLine, report);
    }

    private static string RoleLabel(string role) => role switch
    {
        Roles.AgencyAdmin => "Agency Administrator",
        Roles.Finance => "Finance",
        Roles.PortfolioManager => "Portfolio Manager",
        _ => role,
    };

    private static Person PersonFor(HumoDbContext db, Dictionary<string, Person> people, Guid orgId, string name, string email, string phone, DateTimeOffset now)
    {
        if (people.TryGetValue(name, out var known)) return known;
        var parts = name.Split(' ', 2);
        var person = new Person
        {
            Id = Guid.CreateVersion7(), OrganisationId = orgId, FirstName = parts[0], LastName = parts.Length > 1 ? parts[1] : "", Kind = "individual", DisplayName = name,
            Initials = string.Concat(parts.Select(p => p[0])).ToUpperInvariant(), Email = email, Phone = phone, PreferredChannel = "email", CreatedAt = now,
        };
        db.People.Add(person);
        people[name] = person;
        return person;
    }

    private static async Task UserAsync(HumoDbContext db, UserManager<HumoUser> users, Guid orgId, string name, string email, Guid? personId,
        List<(string Role, string ScopeType, List<string> SchemeIds, string? UnitId)> roles, DateTimeOffset now)
    {
        var user = new HumoUser
        {
            Id = Guid.CreateVersion7(), UserName = email, Email = email, EmailConfirmed = true, Name = name, Kind = IdentityKinds.Customer, Status = IdentityStatuses.Active,
            PersonId = personId?.ToString(),
        };
        var created = await users.CreateAsync(user);
        if (!created.Succeeded) throw new InvalidOperationException($"Couldn't add {email}: {string.Join(", ", created.Errors.Select(e => e.Description))}");
        db.Memberships.Add(new Membership { Id = Guid.CreateVersion7(), UserId = user.Id, OrganisationId = orgId, Since = now });
        foreach (var (role, scopeType, schemeIds, unitId) in roles)
            db.RoleAssignments.Add(new RoleAssignment
            {
                Id = Guid.CreateVersion7(), UserId = user.Id, Role = role, OrganisationId = orgId, ScopeType = scopeType, SchemeIds = schemeIds, UnitId = unitId,
                Label = RoleLabel(role), GrantedBy = "Development seed", GrantedAt = now,
            });
    }
}
