using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Messaging;

/// <summary>
/// Counts each organisation's SMS (and, once it's on the API, WhatsApp) per calendar month, against the package's
/// included SMS and the bundles it bought (CommercialRules.Messages). A new month starts from zero: nothing rolls over.
/// </summary>
public sealed class MessageUsage(HumoDbContext db, TimeProvider clock)
{
    public string Period => clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).ToString("yyyy-MM");

    /// <summary>One message accepted by the provider: <paramref name="units"/> SMS parts (or one WhatsApp message).</summary>
    public async Task RecordAsync(Guid organisationId, string channel, int units, CancellationToken ct)
    {
        var period = Period;
        var row = await db.MessageUsage.FirstOrDefaultAsync(u => u.OrganisationId == organisationId && u.Period == period && u.Channel == channel, ct);
        if (row is null) db.MessageUsage.Add(row = new MessageUsageRow { OrganisationId = organisationId, Period = period, Channel = channel });
        row.Units += Math.Max(1, units);
        row.Messages++;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>This month's units by channel.</summary>
    public async Task<Dictionary<string, int>> ThisMonthAsync(Guid organisationId, CancellationToken ct)
    {
        var period = Period;
        return await db.MessageUsage.Where(u => u.OrganisationId == organisationId && u.Period == period).ToDictionaryAsync(u => u.Channel, u => u.Units, ct);
    }

    public static int SmsUnits(string text, int? providerParts) => providerParts is > 0 ? providerParts.Value : CommercialRules.SmsParts(text);
}
