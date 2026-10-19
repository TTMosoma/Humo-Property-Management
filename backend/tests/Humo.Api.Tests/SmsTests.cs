using System.Net;
using System.Text;
using System.Text.Json;
using Humo.Infrastructure.Messaging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Humo.Api.Tests;

/// <summary>SMS through SMSSouthAfrica (MyMobileAPI v3), chosen by configuration (D14).</summary>
public sealed class SmsTests
{
    [Theory]
    [InlineData("082 123 4567", "27821234567")]
    [InlineData("+27 82 123 4567", "27821234567")]
    [InlineData("0027821234567", "27821234567")]
    [InlineData("27-72-555-0101", "27725550101")]
    [InlineData("(061) 000 1111", "27610001111")]
    [InlineData("+44 7700 900123", "447700900123")]
    public void Numbers_are_sent_in_international_form(string input, string expected)
    {
        Assert.True(MobileNumber.TryNormalise(input, out var msisdn));
        Assert.Equal(expected, msisdn);
    }

    [Theory]
    [InlineData("")]
    [InlineData("011 123 4567")] // a landline
    [InlineData("082 123 456")] // too short
    [InlineData("not a number")]
    public void Numbers_that_can_t_receive_SMS_are_refused(string input) => Assert.False(MobileNumber.TryNormalise(input, out _));

    [Fact]
    public void Numbers_are_masked_in_logs() => Assert.Equal("2782***4567", MobileNumber.Mask("27821234567"));

    [Fact]
    public async Task Sends_one_message_with_Basic_auth_and_the_options_Humo_uses()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, """
            {"statusCode":200,"errors":[],"sendResponse":{"cost":0.25,"remainingBalance":99.75,"eventId":123456789,"sample":"x","messages":1,"parts":1,
             "costBreakdown":[],"errorReport":{"noNetwork":0,"noContents":0,"contentToLong":0,"duplicates":0,"optedOuts":0,"faults":[]}}}
            """);
        var sender = Sender(handler, new SmsSouthAfricaOptions { ClientId = "client", ApiSecret = "secret", TestMode = true, ValidityHours = 24 });

        var receipt = await sender.SendAsync(new SmsMessage("082 123 4567", "Your levy statement is ready", Reference: "stmt-42"));

        Assert.True(receipt.Accepted);
        Assert.Equal("123456789", receipt.ProviderMessageId);
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://rest.mymobileapi.com/v3/BulkMessages", request.Uri);
        Assert.Equal("Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes("client:secret")), request.Authorization);
        using var body = JsonDocument.Parse(request.Body);
        var message = body.RootElement.GetProperty("messages")[0];
        Assert.Equal("27821234567", message.GetProperty("destination").GetString());
        Assert.Equal("Your levy statement is ready", message.GetProperty("content").GetString());
        Assert.Equal("stmt-42", message.GetProperty("customerId").GetString());
        var options = body.RootElement.GetProperty("sendOptions");
        Assert.Equal("Humo", options.GetProperty("senderId").GetString());
        Assert.True(options.GetProperty("testMode").GetBoolean());
        Assert.Equal(24, options.GetProperty("validityPeriod").GetInt32());
    }

    [Fact]
    public async Task A_fault_on_the_number_is_reported_not_hidden()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, """
            {"statusCode":200,"errors":[],"sendResponse":{"cost":0,"remainingBalance":100,"eventId":5,"sample":"","messages":0,"parts":0,"costBreakdown":[],
             "errorReport":{"noNetwork":1,"noContents":0,"contentToLong":0,"duplicates":0,"optedOuts":0,
             "faults":[{"rawDestination":"27821234567","scrubbedDestination":"27821234567","customerId":"x","errorMessage":"No network","status":"Failed"}]}}}
            """);
        var receipt = await Sender(handler).SendAsync(new SmsMessage("0821234567", "Hi"));
        Assert.False(receipt.Accepted);
        Assert.Equal("No network", receipt.Error);
    }

    [Fact]
    public async Task A_refused_API_key_is_reported()
    {
        var receipt = await Sender(new FakeHandler(HttpStatusCode.Unauthorized, "")).SendAsync(new SmsMessage("0821234567", "Hi"));
        Assert.False(receipt.Accepted);
        Assert.Contains("API key", receipt.Error);
    }

    [Fact]
    public async Task A_bad_number_is_refused_before_calling_the_provider()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, "{}");
        var receipt = await Sender(handler).SendAsync(new SmsMessage("011 123 4567", "Hi"));
        Assert.False(receipt.Accepted);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Without_credentials_it_fails_loudly()
    {
        var sender = Sender(new FakeHandler(HttpStatusCode.OK, "{}"), new SmsSouthAfricaOptions());
        await Assert.ThrowsAsync<InvalidOperationException>(() => sender.SendAsync(new SmsMessage("0821234567", "Hi")));
    }

    [Fact]
    public void The_provider_is_chosen_by_configuration()
    {
        ISmsSender[] senders = [new LogSmsSender(NullLogger<LogSmsSender>.Instance), Sender(new FakeHandler(HttpStatusCode.OK, "{}"))];
        Assert.Equal("Log", new SmsGateway(senders, Options.Create(new SmsOptions { Provider = "log" })).Current.Name);
        Assert.Equal("SmsSouthAfrica", new SmsGateway(senders, Options.Create(new SmsOptions { Provider = "SmsSouthAfrica" })).Current.Name);
        Assert.Throws<InvalidOperationException>(() => new SmsGateway(senders, Options.Create(new SmsOptions { Provider = "Carrier pigeon" })).Current);
    }

    // ---- Webhook signatures ----

    private static readonly string Secret = Convert.ToBase64String(Encoding.UTF8.GetBytes("humo-test-webhook-secret"));
    private const string Url = "https://pm.humo.co.za/api/webhooks/sms/smssouthafrica";
    private const string Body = """{"id":1,"eventId":123456789,"customerId":"stmt-42","phoneNumber":"27821234567","status":"DELIVRD"}""";
    private static readonly DateTimeOffset Now = new(2026, 10, 19, 8, 0, 0, TimeSpan.Zero);
    private static readonly string Timestamp = Now.ToUnixTimeSeconds().ToString();

    [Fact]
    public void A_correctly_signed_report_is_accepted()
    {
        var signature = SmsWebhookSignature.Sign(Secret, Timestamp, "POST", Url, Body);
        Assert.StartsWith("v1,hmac_sha256=", signature);
        Assert.True(SmsWebhookSignature.IsValid(Secret, signature, Timestamp, "POST", Url, Body, Now.AddMinutes(1)));
    }

    [Fact]
    public void The_signature_is_HMAC_SHA256_over_the_documented_canonical_string()
    {
        // Independent of Sign(): v1:{timestamp}|{METHOD}|{url}|{body}, uppercase hex.
        var expected = Convert.ToHexString(System.Security.Cryptography.HMACSHA256.HashData(
            Convert.FromBase64String(Secret), Encoding.UTF8.GetBytes($"v1:{Timestamp}|POST|{Url}|{Body}")));
        Assert.Equal("v1,hmac_sha256=" + expected, SmsWebhookSignature.Sign(Secret, Timestamp, "post", Url, Body));
    }

    [Fact]
    public void A_changed_body_a_stale_report_or_no_secret_is_refused()
    {
        var signature = SmsWebhookSignature.Sign(Secret, Timestamp, "POST", Url, Body);
        Assert.False(SmsWebhookSignature.IsValid(Secret, signature, Timestamp, "POST", Url, Body.Replace("DELIVRD", "UNDELIV"), Now));
        Assert.False(SmsWebhookSignature.IsValid(Secret, signature, Timestamp, "POST", Url, Body, Now.AddMinutes(6)));
        Assert.False(SmsWebhookSignature.IsValid(null, signature, Timestamp, "POST", Url, Body, Now));
        Assert.False(SmsWebhookSignature.IsValid(Secret, null, Timestamp, "POST", Url, Body, Now));
    }

    [Fact]
    public async Task The_webhook_endpoint_accepts_only_signed_reports()
    {
        using var api = new HumoApiFactory().With("Sms:SmsSouthAfrica:WebhookSecret", Secret);
        var client = api.Client();
        var ts = api.Clock.GetUtcNow().ToUnixTimeSeconds().ToString();
        // The provider signs the public address it called (App:PublicUrl in the tests is https://localhost).
        const string publicUrl = "https://localhost/api/webhooks/sms/smssouthafrica";

        HttpRequestMessage Post(string? signature) => new HttpRequestMessage(HttpMethod.Post, "/api/webhooks/sms/smssouthafrica")
        {
            Content = new StringContent(Body, Encoding.UTF8, "application/json"),
            Headers = { { SmsWebhookSignature.TimestampHeader, ts } },
        }.With(signature);

        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Post(SmsWebhookSignature.Sign(Secret, ts, "POST", publicUrl, Body)))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(Post(null))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(Post(SmsWebhookSignature.Sign(Secret, ts, "POST", "https://elsewhere/x", Body)))).StatusCode);
    }

    private static SmsSouthAfricaSender Sender(FakeHandler handler, SmsSouthAfricaOptions? options = null) => new(
        new FakeFactory(handler),
        Options.Create(options ?? new SmsSouthAfricaOptions { ClientId = "client", ApiSecret = "secret" }),
        Options.Create(new SmsOptions { Provider = "SmsSouthAfrica", SenderId = "Humo" }),
        NullLogger<SmsSouthAfricaSender>.Instance);

    private sealed record SentRequest(HttpMethod Method, string Uri, string? Authorization, string Body);

    private sealed class FakeHandler(HttpStatusCode status, string response) : HttpMessageHandler
    {
        public List<SentRequest> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(new(request.Method, request.RequestUri!.ToString(), request.Headers.Authorization?.ToString(), request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct)));
            return new HttpResponseMessage(status) { Content = new StringContent(response, Encoding.UTF8, "application/json") };
        }
    }

    private sealed class FakeFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}

internal static class RequestExtensions
{
    public static HttpRequestMessage With(this HttpRequestMessage request, string? signature)
    {
        if (signature is not null) request.Headers.Add(SmsWebhookSignature.SignatureHeader, signature);
        return request;
    }
}
