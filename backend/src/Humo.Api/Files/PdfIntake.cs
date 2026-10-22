using Humo.Api.Commands;
using Humo.Infrastructure.Files;

namespace Humo.Api.Files;

/// <summary>
/// The checks every uploaded PDF passes before it's stored (docs/18 R-11): it is a PDF by its content, not its name; it is
/// within the size limit; and a malware scan finds nothing. A file that fails any check is refused, and nothing is stored.
/// </summary>
public static class PdfIntake
{
    public sealed record Accepted(byte[] Bytes, string Name);

    public static async Task<(Accepted? File, IResult? Refusal)> CheckAsync(IFormFile? file, int maxBytes, IFileScanner scanner, CancellationToken ct)
    {
        var tooLarge = Problems.Validation(new() { ["file"] = $"That file is larger than {maxBytes / 1024 / 1024} MB." });
        if (file is null) return (null, Problems.Validation(new() { ["file"] = "Choose a PDF to upload." }));
        if (file.Length > maxBytes) return (null, tooLarge);

        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);
        var bytes = buffer.ToArray();
        if (bytes.Length > maxBytes) return (null, tooLarge);

        var name = Path.GetFileName(file.FileName) is { Length: > 0 } n ? n[..Math.Min(n.Length, 200)] : "document.pdf";
        if (!Path.GetExtension(name).Equals(".pdf", StringComparison.OrdinalIgnoreCase) || !bytes.AsSpan().StartsWith("%PDF-"u8))
            return (null, Problems.Validation(new() { ["file"] = "Only PDF files can be uploaded." }));

        // A file that can't be checked isn't stored: the scanner has to answer first.
        ScanResult scan;
        try { scan = await scanner.ScanAsync(bytes, ct); }
        catch (ScannerUnavailableException)
        {
            return (null, Results.Problem(title: "The file can’t be checked for viruses right now, so it wasn’t stored. Try again shortly.", statusCode: StatusCodes.Status503ServiceUnavailable));
        }
        if (!scan.Clean)
            return (null, Results.Problem(title: $"The file was refused: {scan.Threat} was found in it.", statusCode: StatusCodes.Status422UnprocessableEntity,
                extensions: new Dictionary<string, object?> { ["code"] = "infected" }));

        return (new Accepted(bytes, name), null);
    }
}
