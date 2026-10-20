using System.Text.RegularExpressions;

namespace Humo.Domain.Finance;

/// <summary>An account a receipt could belong to: its unit's details as matching needs them.</summary>
public sealed record MatchCandidate(Guid AccountId, string AccountNo, string UnitNumber, decimal MonthlyLevy, decimal Balance,
    IReadOnlyList<(string FirstName, string LastName, string DisplayName)> Owners, (string LastName, string DisplayName)? Tenant);

public sealed record ReceiptMatch(Guid AccountId, int Confidence, IReadOnlyList<string> Reasons);

/// <summary>
/// Suggests accounts for a receipt, each with a confidence and the reasons (rule for rule as the
/// prototype): an agent should never have to trust a black box with owners' money.
/// </summary>
public static class ReceiptMatching
{
    public static List<ReceiptMatch> Match(string reference, string payer, decimal amount, string schemeCode, IEnumerable<MatchCandidate> candidates,
        IEnumerable<(string Pattern, Guid AccountId)> rules)
    {
        var refLower = reference.ToLowerInvariant();
        var payerLower = payer.ToLowerInvariant();
        var text = $"{refLower} {payerLower}";
        var compact = Regex.Replace(text, @"[\s-]", "");
        var code = Regex.Escape(schemeCode.ToLowerInvariant());
        var ruleList = rules.ToList();
        var payerInitial = Regex.Match(payerLower, @"^([a-z])\s") is { Success: true } mi ? mi.Groups[1].Value[0] : (char?)null;
        var results = new List<ReceiptMatch>();
        foreach (var c in candidates)
        {
            var reasons = new List<string>();
            var score = 0;
            if (ruleList.FirstOrDefault(r => r.AccountId == c.AccountId && text.Contains(r.Pattern.ToLowerInvariant())) is { Pattern: { } pattern })
            {
                score += 95;
                reasons.Add($"Remembered payer rule “{pattern}”");
            }
            var number = Regex.Escape(c.UnitNumber.TrimStart('0'));
            var unitRef = compact.Contains(c.AccountNo.ToLowerInvariant().Replace("-", ""))
                || Regex.IsMatch(text, $@"\b{code}\s*-?\s*0*{number}\b")
                || Regex.IsMatch(text, $@"\b(unit|flat|erf|nr|no)\.?\s*0*{number}\b");
            if (unitRef)
            {
                score += 55;
                reasons.Add($"Reference mentions Unit {c.UnitNumber}");
            }
            // Names match as whole words ("Nel" must not match "Anele"); a different initial weakens the match.
            foreach (var o in c.Owners)
            {
                if (!HasWord(text, o.LastName)) continue;
                var sameInitial = payerInitial is null || payerInitial == char.ToLowerInvariant(o.FirstName.FirstOrDefault());
                score += sameInitial ? 30 : 15;
                reasons.Add(sameInitial ? $"Payer name matches owner {o.DisplayName}" : $"Surname matches owner {o.DisplayName} (different initial)");
                if (HasWord(text, o.FirstName)) score += 10;
            }
            if (c.Tenant is { } t && HasWord(text, t.LastName))
            {
                score += 12;
                reasons.Add($"Payer matches the tenant ({t.DisplayName}), not the owner");
            }
            if (c.MonthlyLevy > 0 && Math.Abs(amount - c.MonthlyLevy) < 0.01m)
            {
                score += 20;
                reasons.Add("Amount equals the monthly levy");
            }
            if (c.Balance > 0 && Math.Abs(amount - c.Balance) < 0.01m)
            {
                score += 25;
                reasons.Add("Amount clears the outstanding balance");
            }
            if (c.MonthlyLevy > 0 && amount > c.MonthlyLevy * 1.6m && unitRef)
                reasons.Add($"Amount is {amount / c.MonthlyLevy:0.0}× the levy — check before allocating");
            if (score >= 20) results.Add(new ReceiptMatch(c.AccountId, Math.Min(99, score), reasons));
        }
        return results.OrderByDescending(r => r.Confidence).Take(3).ToList();
    }

    private static bool HasWord(string text, string word)
    {
        var w = Regex.Escape(word.ToLowerInvariant());
        return word.Length > 2 && Regex.IsMatch(text, $"(^|[^a-z]){w}([^a-z]|$)");
    }
}
