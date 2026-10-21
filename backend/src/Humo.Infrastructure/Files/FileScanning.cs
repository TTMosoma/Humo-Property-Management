using System.Net.Sockets;
using System.Text;
using Microsoft.Extensions.Options;

namespace Humo.Infrastructure.Files;

public sealed record ScanResult(bool Clean, string? Threat);

/// <summary>The scanner couldn't give an answer. Uploads fail closed: a file that wasn't checked isn't stored.</summary>
public sealed class ScannerUnavailableException(string message) : Exception(message);

/// <summary>Checks a file for malware before it's stored (docs/18 R-11).</summary>
public interface IFileScanner
{
    Task<ScanResult> ScanAsync(byte[] content, CancellationToken ct);
}

/// <summary>
/// ClamAV through its daemon (clamd) on this server: the INSTREAM command, in chunks, then the answer. Configured by
/// <c>Files:ClamAv:Host</c> and <c>Port</c>. Nothing is sent anywhere else.
/// </summary>
public sealed class ClamAvScanner(IOptions<FilesOptions> options) : IFileScanner
{
    private const int ChunkBytes = 64 * 1024;

    public async Task<ScanResult> ScanAsync(byte[] content, CancellationToken ct)
    {
        var clam = options.Value.ClamAv;
        if (string.IsNullOrWhiteSpace(clam.Host))
            throw new ScannerUnavailableException("No virus scanner is configured (Files:ClamAv:Host).");

        string reply;
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(clam.Host, clam.Port, ct);
            await using var net = client.GetStream();
            await net.WriteAsync(Encoding.ASCII.GetBytes("zINSTREAM\0"), ct);
            for (var offset = 0; offset < content.Length; offset += ChunkBytes)
            {
                var length = Math.Min(ChunkBytes, content.Length - offset);
                await net.WriteAsync(BigEndian(length), ct);
                await net.WriteAsync(content.AsMemory(offset, length), ct);
            }
            await net.WriteAsync(new byte[4], ct); // a zero-length chunk ends the stream
            using var buffer = new MemoryStream();
            await net.CopyToAsync(buffer, ct);
            reply = Encoding.ASCII.GetString(buffer.ToArray()).TrimEnd('\0', '\n', '\r');
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            throw new ScannerUnavailableException("The virus scanner couldn't be reached.");
        }

        // The answer is "stream: OK", or "stream: <threat> FOUND".
        if (!reply.StartsWith("stream: ", StringComparison.Ordinal))
            throw new ScannerUnavailableException($"The virus scanner answered something unexpected: {reply}");
        var answer = reply["stream: ".Length..];
        if (answer == "OK") return new ScanResult(true, null);
        if (answer.EndsWith(" FOUND", StringComparison.Ordinal)) return new ScanResult(false, answer[..^" FOUND".Length]);
        throw new ScannerUnavailableException($"The virus scanner answered something unexpected: {reply}");
    }

    private static byte[] BigEndian(int value)
    {
        var bytes = BitConverter.GetBytes(value);
        if (BitConverter.IsLittleEndian) Array.Reverse(bytes);
        return bytes;
    }
}
