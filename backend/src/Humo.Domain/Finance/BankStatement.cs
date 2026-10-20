using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Humo.Domain.Finance;

/// <summary>Which column holds what, by header name (docs/22 §1). Either <c>Amount</c> (credits positive) or <c>Credit</c> (+ optional <c>Debit</c>).</summary>
public sealed record StatementMapping(string Date, string DateFormat, string? Amount, string? Credit, string? Debit, string Reference, string? Payer);

/// <summary>One row as read: a credit becomes a receipt; debits and unreadable rows don't. <c>Row</c> counts the header as row 1.</summary>
public sealed record StatementLine(int Row, string Kind, string? Date = null, decimal? Amount = null, string? Reference = null, string? Payer = null, string? Problem = null);

/// <summary>
/// Bank statements as CSV, rule for rule as the frontend's <c>bank-statement.ts</c>, so the preview and the
/// import agree on what a row means. Every bank's export differs: columns are mapped once per trust account.
/// </summary>
public static partial class BankStatement
{
    public static readonly string[] DateFormats = ["yyyy-mm-dd", "dd/mm/yyyy", "mm/dd/yyyy"];

    /// <summary>A tiny RFC 4180 reader: commas or semicolons, quoted fields, "" escapes, CRLF or LF.</summary>
    public static List<string[]> ParseCsv(string text)
    {
        var clean = text.TrimStart('﻿');
        var firstLine = clean.Split('\n', 2)[0];
        var delimiter = firstLine.Count(c => c == ';') > firstLine.Count(c => c == ',') ? ';' : ',';
        var rows = new List<string[]>();
        var row = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < clean.Length; i++)
        {
            var c = clean[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < clean.Length && clean[i + 1] == '"') { field.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else field.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c == delimiter) { row.Add(field.ToString()); field.Clear(); }
            else if (c is '\n' or '\r')
            {
                if (c == '\r' && i + 1 < clean.Length && clean[i + 1] == '\n') i++;
                row.Add(field.ToString());
                if (row.Any(f => f.Trim() != "")) rows.Add([.. row]);
                row.Clear();
                field.Clear();
            }
            else field.Append(c);
        }
        row.Add(field.ToString());
        if (row.Any(f => f.Trim() != "")) rows.Add([.. row]);
        return rows;
    }

    /// <summary>"R 1 234,50", "1,234.50", "(500.00)", "-500" → the amount, or null.</summary>
    public static decimal? ParseAmount(string raw)
    {
        var s = Regex.Replace(Regex.Replace(raw.Trim(), @"^R\s*", "", RegexOptions.IgnoreCase), @"\s", "");
        if (s.Length == 0) return null;
        var negative = false;
        if (s.StartsWith('(') && s.EndsWith(')')) { negative = true; s = s[1..^1]; }
        if (s.StartsWith('-')) { negative = true; s = s[1..]; }
        // A comma followed by exactly two digits at the end is a decimal comma.
        if (DecimalComma().IsMatch(s) && !DecimalPoint().IsMatch(s)) s = s.Replace(".", "").Replace(',', '.');
        else s = s.Replace(",", "");
        if (!Number().IsMatch(s)) return null;
        var n = Math.Round(decimal.Parse(s, CultureInfo.InvariantCulture), 2, MidpointRounding.AwayFromZero);
        return negative ? -n : n;
    }

    /// <summary>The date as yyyy-MM-dd, or null if it doesn't read in the given format.</summary>
    public static string? ParseDate(string raw, string format)
    {
        var s = raw.Trim();
        var iso = IsoDate().Match(s);
        var dmy = DmyDate().Match(s);
        int y, m, d;
        if (format == "yyyy-mm-dd" && iso.Success) (y, m, d) = (int.Parse(iso.Groups[1].Value), int.Parse(iso.Groups[2].Value), int.Parse(iso.Groups[3].Value));
        else if (format == "dd/mm/yyyy" && dmy.Success) (y, m, d) = (int.Parse(dmy.Groups[3].Value), int.Parse(dmy.Groups[2].Value), int.Parse(dmy.Groups[1].Value));
        else if (format == "mm/dd/yyyy" && dmy.Success) (y, m, d) = (int.Parse(dmy.Groups[3].Value), int.Parse(dmy.Groups[1].Value), int.Parse(dmy.Groups[2].Value));
        else return null;
        if (m is < 1 or > 12 || d < 1 || y < 1 || d > DateTime.DaysInMonth(y, m)) return null;
        return $"{y:D4}-{m:D2}-{d:D2}";
    }

    /// <summary>Reads every data row with the mapping. The first row must be the header.</summary>
    public static List<StatementLine> Read(List<string[]> rows, StatementMapping mapping)
    {
        var header = (rows.FirstOrDefault() ?? []).Select(h => h.Trim().ToLowerInvariant()).ToList();
        int Col(string? name) => name is null ? -1 : header.IndexOf(name.Trim().ToLowerInvariant());
        var at = new { Date = Col(mapping.Date), Amount = Col(mapping.Amount), Credit = Col(mapping.Credit), Debit = Col(mapping.Debit), Reference = Col(mapping.Reference), Payer = Col(mapping.Payer) };
        return rows.Skip(1).Select((cells, i) =>
        {
            var row = i + 2;
            string Cell(int col) => col >= 0 && col < cells.Length ? cells[col].Trim() : "";
            var date = ParseDate(Cell(at.Date), mapping.DateFormat);
            if (date is null) return new StatementLine(row, "invalid", Problem: $"The date “{Cell(at.Date)}” doesn’t read as {mapping.DateFormat}.");
            decimal? amount;
            if (at.Amount >= 0) amount = ParseAmount(Cell(at.Amount));
            else
            {
                var credit = Cell(at.Credit).Length > 0 ? ParseAmount(Cell(at.Credit)) : 0;
                var debit = Cell(at.Debit).Length > 0 ? ParseAmount(Cell(at.Debit)) : 0;
                amount = credit is null || debit is null ? null : Ledger.Round2(credit.Value - Math.Abs(debit.Value));
            }
            if (amount is null) return new StatementLine(row, "invalid", date, Problem: "The amount isn’t a number.");
            if (amount == 0) return new StatementLine(row, "invalid", date, Problem: "The amount is zero.");
            var reference = Cell(at.Reference);
            var payer = Cell(at.Payer) is { Length: > 0 } p ? p : null;
            if (amount < 0) return new StatementLine(row, "debit", date, amount, reference, payer);
            if (reference.Length == 0 && payer is null) return new StatementLine(row, "invalid", date, amount, Problem: "No reference or payer to match it by.");
            return new StatementLine(row, "credit", date, amount, reference, payer);
        }).ToList();
    }

    /// <summary>The mapping's columns must exist in the header, with an amount or a credit column.</summary>
    public static Dictionary<string, string> MappingProblems(string[] header, StatementMapping m)
    {
        var names = header.Select(h => h.Trim().ToLowerInvariant()).ToHashSet();
        bool Has(string? c) => !string.IsNullOrWhiteSpace(c) && names.Contains(c.Trim().ToLowerInvariant());
        var e = new Dictionary<string, string>();
        if (!Has(m.Date)) e["date"] = "Choose the date column.";
        if (!DateFormats.Contains(m.DateFormat)) e["dateFormat"] = "Choose the date format.";
        if (!Has(m.Reference)) e["reference"] = "Choose the reference or description column.";
        if (!Has(m.Amount) && !Has(m.Credit)) e["amount"] = "Choose an amount column, or a credit column.";
        if (!string.IsNullOrEmpty(m.Payer) && !Has(m.Payer)) e["payer"] = "That payer column isn’t in the file.";
        if (!string.IsNullOrEmpty(m.Debit) && !Has(m.Debit)) e["debit"] = "That debit column isn’t in the file.";
        return e;
    }

    /// <summary>"scheme|yyyy-mm-dd|amount|reference": two receipts with the same key are the same deposit.</summary>
    public static string ReceiptKey(Guid schemeId, string date, decimal amount, string reference) =>
        $"{schemeId}|{date[..Math.Min(10, date.Length)]}|{amount.ToString("0.00", CultureInfo.InvariantCulture)}|{reference.Trim().ToLowerInvariant()}";

    /// <summary>A receipt date can't be in the future or more than 12 months old (docs/22 §1). Null when it's fine.</summary>
    public static string? ReceiptDateProblem(string? date, DateOnly today)
    {
        if (date is null || !DateOnly.TryParseExact(date[..Math.Min(10, date.Length)], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return "Enter the date the money arrived.";
        if (d > today) return "The date can’t be in the future.";
        if (d < today.AddDays(-365)) return "That’s more than 12 months ago. Older receipts need a journal on the account instead.";
        return null;
    }

    [GeneratedRegex(@",\d{2}$")] private static partial Regex DecimalComma();
    [GeneratedRegex(@"\.\d{2}$")] private static partial Regex DecimalPoint();
    [GeneratedRegex(@"^\d+(\.\d+)?$")] private static partial Regex Number();
    [GeneratedRegex(@"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})")] private static partial Regex IsoDate();
    [GeneratedRegex(@"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})")] private static partial Regex DmyDate();
}
