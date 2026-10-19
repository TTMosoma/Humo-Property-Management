using Humo.Infrastructure.Data;

namespace Humo.Api.Audit;

/// <summary>Appends to the audit log (doc 24 C9). Nothing here updates or deletes a row.</summary>
public sealed class AuditLog(HumoDbContext db, IHttpContextAccessor http, TimeProvider clock)
{
    public void Record(string action, string result, HumoUser? actor = null, string? reason = null, string category = "security",
        string? role = null, Guid? organisationId = null, string? resource = null, string? resourceId = null, string? stepUpMethod = null)
    {
        var ctx = http.HttpContext;
        db.Audit.Add(new AuditEntry
        {
            At = clock.GetUtcNow(),
            Category = category,
            ActorId = actor?.Id,
            ActorName = actor?.Name ?? "Unknown",
            Role = role,
            OrganisationId = organisationId,
            Action = action,
            Resource = resource,
            ResourceId = resourceId,
            Result = result,
            Reason = reason,
            StepUpMethod = stepUpMethod,
            Ip = ctx?.Connection.RemoteIpAddress?.ToString(),
            UserAgent = ctx?.Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua[..Math.Min(ua.Length, 300)] : null,
        });
    }
}
