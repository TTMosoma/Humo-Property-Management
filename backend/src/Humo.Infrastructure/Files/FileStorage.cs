using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace Humo.Infrastructure.Files;

/// <summary>
/// Uploaded files (docs/18 R-11). Files are kept outside the repository and the web root, on the server's own disk:
/// <c>Files:Root</c>, which must sit on an encrypted disk and be included in the backups (doc 26 §6). Nothing is
/// served from here directly; the API checks access and signs a short-lived link (see <c>SignedLinks</c>).
/// </summary>
public sealed class FilesOptions
{
    public const string Section = "Files";

    /// <summary>Where files are kept. An absolute path in production (doc 18 D-12).</summary>
    public string Root { get; set; } = "storage/files";
    /// <summary>The largest file accepted, in bytes. 20 MB by default.</summary>
    public int MaxBytes { get; set; } = 20 * 1024 * 1024;
    /// <summary>
    /// The key that signs download links, base64, at least 32 bytes. Generate with <c>openssl rand -base64 32</c>. Keep it in
    /// the server's .env, never in git. Changing it ends every link that's open.
    /// </summary>
    public string? SigningKey { get; set; }
    /// <summary>How long a download link works.</summary>
    public TimeSpan LinkLifetime { get; set; } = TimeSpan.FromMinutes(5);
    public ClamAvOptions ClamAv { get; set; } = new();

    public sealed class ClamAvOptions
    {
        /// <summary>The clamd host (ClamAV on this server, e.g. 127.0.0.1). Empty: no scanner, so no uploads.</summary>
        public string? Host { get; set; }
        public int Port { get; set; } = 3310;
    }
}

/// <summary>Keeps file contents, under a random key that says nothing about the file's name or owner.</summary>
public interface IFileStore
{
    /// <summary>Writes the content and returns its storage key.</summary>
    Task<string> SaveAsync(byte[] content, CancellationToken ct);
    Task<Stream> OpenAsync(string key, CancellationToken ct);
}

public sealed class LocalFileStore(IOptions<FilesOptions> options) : IFileStore
{
    private static readonly Regex Key = new("^[0-9a-f]{32}$", RegexOptions.CultureInvariant);

    public async Task<string> SaveAsync(byte[] content, CancellationToken ct)
    {
        var key = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var path = PathFor(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        // CreateNew: a key is never overwritten.
        await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous);
        await file.WriteAsync(content, ct);
        return key;
    }

    public Task<Stream> OpenAsync(string key, CancellationToken ct) =>
        Task.FromResult<Stream>(new FileStream(PathFor(key), FileMode.Open, FileAccess.Read, FileShare.Read, 81920, FileOptions.Asynchronous));

    /// <summary>The path for a key: the first two characters name a folder, so no folder holds too many files.</summary>
    private string PathFor(string key)
    {
        if (!Key.IsMatch(key)) throw new ArgumentException("Not a storage key.", nameof(key));
        return Path.Combine(Path.GetFullPath(options.Value.Root), key[..2], key);
    }
}
