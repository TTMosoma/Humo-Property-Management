using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Playwright;

namespace Humo.Infrastructure.Documents;

/// <summary>
/// Turns a page of the app into PDF bytes (D8): headless Chromium opens the app's print route,
/// which draws the document with the same templates people see on screen.
/// </summary>
public interface IPdfRenderer
{
    /// <summary>Opens <paramref name="url"/>, waits for the page to say it's ready (<c>[data-print-ready]</c>) and prints it to A4.</summary>
    Task<byte[]> RenderAsync(string url, CancellationToken ct = default);
}

public sealed class DocumentOptions
{
    public const string Section = "Documents";

    /// <summary>
    /// Where Chromium reaches the app's print route, e.g. http://web:8080 inside Docker.
    /// Empty: the app's public address (App:PublicUrl).
    /// </summary>
    public string? RenderBaseUrl { get; set; }
    /// <summary>A Chromium already on the machine (the Docker image installs one). Empty: Playwright's own download.</summary>
    public string? ChromiumPath { get; set; }
    /// <summary>How long a page may take to be ready.</summary>
    public TimeSpan RenderTimeout { get; set; } = TimeSpan.FromSeconds(30);
}

/// <summary>One Chromium for the process, started on first use; a page per document.</summary>
public sealed class ChromiumPdfRenderer(IOptions<DocumentOptions> options, ILogger<ChromiumPdfRenderer> logger) : IPdfRenderer, IAsyncDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private IPlaywright? playwright;
    private IBrowser? browser;

    public async Task<byte[]> RenderAsync(string url, CancellationToken ct = default)
    {
        var b = await BrowserAsync(ct);
        var page = await b.NewPageAsync(new() { ViewportSize = new() { Width = 794, Height = 1123 } });
        try
        {
            var timeout = (float)options.Value.RenderTimeout.TotalMilliseconds;
            await page.GotoAsync(url, new() { Timeout = timeout });
            await page.WaitForSelectorAsync("[data-print-ready]", new() { Timeout = timeout, State = WaitForSelectorState.Attached });
            if (await page.QuerySelectorAsync("[data-print-error]") is not null) throw new InvalidOperationException("The print page couldn’t load the document.");
            await page.EmulateMediaAsync(new() { Media = Media.Print });
            return await page.PdfAsync(new() { Format = "A4", PrintBackground = true, PreferCSSPageSize = true });
        }
        finally
        {
            await page.CloseAsync();
        }
    }

    private async Task<IBrowser> BrowserAsync(CancellationToken ct)
    {
        if (browser is { IsConnected: true }) return browser;
        await gate.WaitAsync(ct);
        try
        {
            if (browser is { IsConnected: true }) return browser;
            playwright ??= await Playwright.CreateAsync();
            var path = options.Value.ChromiumPath;
            browser = await playwright.Chromium.LaunchAsync(new()
            {
                Headless = true,
                ExecutablePath = string.IsNullOrWhiteSpace(path) ? null : path,
                // In a container Chromium runs as an unprivileged user without a sandbox namespace.
                Args = ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
            });
            logger.LogInformation("Chromium started for PDF rendering ({Version})", browser.Version);
            return browser;
        }
        finally
        {
            gate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (browser is not null) await browser.DisposeAsync();
        playwright?.Dispose();
        gate.Dispose();
    }
}
