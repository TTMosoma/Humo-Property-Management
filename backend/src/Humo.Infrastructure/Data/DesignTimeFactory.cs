using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Infrastructure.Data;

/// <summary>
/// For <c>dotnet ef migrations add</c> only: no database is contacted. Identity
/// reads its schema version from the options in DI, so they're supplied here
/// exactly as the API configures them (v3: passkeys).
/// </summary>
public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<HumoDbContext>
{
    public HumoDbContext CreateDbContext(string[] args)
    {
        var services = new ServiceCollection()
            .Configure<IdentityOptions>(o => o.Stores.SchemaVersion = IdentitySchemaVersions.Version3)
            .BuildServiceProvider();
        return new(new DbContextOptionsBuilder<HumoDbContext>()
            .UseNpgsql("Host=localhost;Database=humo;Username=humo;Password=design-time")
            .UseApplicationServiceProvider(services)
            .Options);
    }
}
