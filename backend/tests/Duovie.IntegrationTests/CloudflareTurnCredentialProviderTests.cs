using System.Net;
using Duovie.Infrastructure.IceServers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Duovie.IntegrationTests;

public sealed class CloudflareTurnCredentialProviderTests
{
    private const string KeyId = "test-key-id";
    private const string ApiToken = "test-long-lived-api-token-secret";

    [Fact]
    public async Task Disabled_provider_never_calls_the_network()
    {
        var handler = new FakeHttpMessageHandler(_ =>
            throw new InvalidOperationException("Should not be called."));
        var provider = CreateProvider(handler, enabled: false);

        var result = await provider.GetTurnServersAsync();

        Assert.Empty(result);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Request_uses_the_server_side_configured_Authorization_header()
    {
        var handler = new FakeHttpMessageHandler(_ =>
            FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, ValidResponseJson()));
        var provider = CreateProvider(handler, enabled: true);

        await provider.GetTurnServersAsync();

        var request = Assert.Single(handler.Requests);
        Assert.Equal($"Bearer {ApiToken}", request.Authorization);
        Assert.Contains($"v1/turn/keys/{KeyId}/credentials/generate-ice-servers", request.RequestUri!.ToString());
    }

    [Fact]
    public async Task Request_body_uses_the_configured_TTL()
    {
        var handler = new FakeHttpMessageHandler(_ =>
            FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, ValidResponseJson()));
        var provider = CreateProvider(handler, enabled: true, ttlSeconds: 7_200);

        await provider.GetTurnServersAsync();

        var request = Assert.Single(handler.Requests);
        Assert.Equal("{\"ttl\":7200}", request.Body);
    }

    [Fact]
    public async Task Valid_provider_response_maps_the_exact_real_Cloudflare_shape_to_provider_neutral_descriptors()
    {
        var handler = new FakeHttpMessageHandler(_ =>
            FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, ValidResponseJson()));
        var provider = CreateProvider(handler, enabled: true);

        var result = await provider.GetTurnServersAsync();

        Assert.Equal(2, result.Count);
        var stunEntry = result[0];
        Assert.Equal(
            ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"],
            stunEntry.Urls);
        Assert.Null(stunEntry.Username);
        Assert.Null(stunEntry.Credential);

        var turnEntry = result[1];
        Assert.Equal(
            [
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turn:turn.cloudflare.com:53?transport=udp",
                "turn:turn.cloudflare.com:3478?transport=tcp",
                "turn:turn.cloudflare.com:80?transport=tcp",
                "turns:turn.cloudflare.com:5349?transport=tcp",
                "turns:turn.cloudflare.com:443?transport=tcp",
            ],
            turnEntry.Urls);
        Assert.Equal("generated-username", turnEntry.Username);
        Assert.Equal("generated-credential", turnEntry.Credential);
    }

    [Fact]
    public async Task A_STUN_only_entry_is_accepted_without_username_or_credential()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            "{\"iceServers\":[{\"urls\":[\"stun:stun.cloudflare.com:3478\"]}]}"));
        var provider = CreateProvider(handler, enabled: true);

        var result = await provider.GetTurnServersAsync();

        var descriptor = Assert.Single(result);
        Assert.Equal(["stun:stun.cloudflare.com:3478"], descriptor.Urls);
        Assert.Null(descriptor.Username);
        Assert.Null(descriptor.Credential);
    }

    [Fact]
    public async Task A_TURN_entry_without_username_and_credential_is_rejected()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            "{\"iceServers\":[{\"urls\":[\"turn:turn.cloudflare.com:3478\"]}]}"));
        var provider = CreateProvider(handler, enabled: true);

        var result = await provider.GetTurnServersAsync();

        Assert.Empty(result);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"iceServers\":null}")]
    [InlineData("{\"iceServers\":[]}")]
    // The old (incorrect) single-object shape must now be rejected as malformed, not
    // silently accepted — Cloudflare's real response is an array.
    [InlineData("{\"iceServers\":{\"urls\":[\"stun:stun.cloudflare.com:3478\"]}}")]
    [InlineData("{\"iceServers\":[null]}")]
    [InlineData("{\"iceServers\":[{\"urls\":[]}]}")]
    [InlineData("{\"iceServers\":[{\"urls\":[\"not-a-valid-scheme:1.2.3.4\"]}]}")]
    [InlineData("{\"iceServers\":[{\"urls\":[\"turn:turn.cloudflare.com:3478\"]}]}")]
    [InlineData("{\"iceServers\":[{\"urls\":[\"turn:turn.cloudflare.com:3478\"],\"username\":\"u\"}]}")]
    [InlineData("{\"iceServers\":[{\"urls\":[\"stun:stun.cloudflare.com:3478\"]},{\"urls\":[\"turn:turn.cloudflare.com:3478\"]}]}")]
    [InlineData("not-json-at-all")]
    public async Task Malformed_provider_response_is_handled_safely(string rawJson)
    {
        var handler = new FakeHttpMessageHandler(_ =>
            FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, rawJson));
        var provider = CreateProvider(handler, enabled: true);

        var result = await provider.GetTurnServersAsync();

        Assert.Empty(result);
    }

    [Fact]
    public async Task Provider_HTTP_failure_degrades_to_empty_without_throwing()
    {
        var handler = new FakeHttpMessageHandler(_ =>
            FakeHttpMessageHandler.JsonResponse(
                HttpStatusCode.Unauthorized,
                "{\"error\":\"invalid api token " + ApiToken + "\"}"));
        var provider = CreateProvider(handler, enabled: true);

        var result = await provider.GetTurnServersAsync();

        Assert.Empty(result);
    }

    [Fact]
    public async Task Provider_failure_never_logs_the_API_token_or_raw_response_body()
    {
        const string rawBodySentinel = "raw provider failure body marker";
        var handler = new FakeHttpMessageHandler(_ =>
            FakeHttpMessageHandler.JsonResponse(
                HttpStatusCode.InternalServerError,
                $"{{\"error\":\"{rawBodySentinel} {ApiToken}\"}}"));
        var loggerProvider = new CapturingLoggerProvider();
        using var loggerFactory = LoggerFactory.Create(builder => builder.AddProvider(loggerProvider));
        var logger = loggerFactory.CreateLogger<CloudflareTurnCredentialProvider>();
        var provider = CreateProvider(handler, enabled: true, logger: logger);

        await provider.GetTurnServersAsync();

        Assert.NotEmpty(loggerProvider.Messages);
        foreach (var message in loggerProvider.Messages)
        {
            Assert.DoesNotContain(ApiToken, message, StringComparison.Ordinal);
            Assert.DoesNotContain(rawBodySentinel, message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Provider_timeout_degrades_safely_without_throwing()
    {
        var handler = new FakeHttpMessageHandler { Hang = true };
        var provider = CreateProvider(handler, enabled: true, clientTimeout: TimeSpan.FromMilliseconds(30));

        var result = await provider.GetTurnServersAsync();

        Assert.Empty(result);
    }

    [Fact]
    public async Task Provider_timeout_never_logs_the_API_token()
    {
        var handler = new FakeHttpMessageHandler { Hang = true };
        var loggerProvider = new CapturingLoggerProvider();
        using var loggerFactory = LoggerFactory.Create(builder => builder.AddProvider(loggerProvider));
        var logger = loggerFactory.CreateLogger<CloudflareTurnCredentialProvider>();
        var provider = CreateProvider(
            handler,
            enabled: true,
            logger: logger,
            clientTimeout: TimeSpan.FromMilliseconds(30));

        await provider.GetTurnServersAsync();

        Assert.NotEmpty(loggerProvider.Messages);
        Assert.Contains(loggerProvider.Messages, message => message.Contains("timed out", StringComparison.OrdinalIgnoreCase));
        foreach (var message in loggerProvider.Messages)
        {
            Assert.DoesNotContain(ApiToken, message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Genuine_caller_cancellation_propagates_instead_of_a_misleading_provider_warning()
    {
        var handler = new FakeHttpMessageHandler { Hang = true };
        var loggerProvider = new CapturingLoggerProvider();
        using var loggerFactory = LoggerFactory.Create(builder => builder.AddProvider(loggerProvider));
        var logger = loggerFactory.CreateLogger<CloudflareTurnCredentialProvider>();
        // A client timeout far longer than the caller's own cancellation, so only the
        // caller's token can be the source of the observed cancellation.
        var provider = CreateProvider(
            handler,
            enabled: true,
            logger: logger,
            clientTimeout: TimeSpan.FromSeconds(30));
        using var cancellationSource = new CancellationTokenSource();
        cancellationSource.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => provider.GetTurnServersAsync(cancellationSource.Token));

        Assert.Empty(loggerProvider.Messages);
    }

    private static CloudflareTurnCredentialProvider CreateProvider(
        FakeHttpMessageHandler handler,
        bool enabled,
        int ttlSeconds = CloudflareTurnOptions.DefaultCredentialTtlSeconds,
        ILogger<CloudflareTurnCredentialProvider>? logger = null,
        TimeSpan? clientTimeout = null)
    {
        var httpClient = new HttpClient(handler)
        {
            BaseAddress = new Uri("https://rtc.live.cloudflare.com/"),
            Timeout = clientTimeout ?? TimeSpan.FromSeconds(5),
        };
        var options = Options.Create(new CloudflareTurnOptions
        {
            Enabled = enabled,
            KeyId = KeyId,
            ApiToken = ApiToken,
            CredentialTtlSeconds = ttlSeconds,
        });

        return new CloudflareTurnCredentialProvider(
            httpClient,
            options,
            logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<CloudflareTurnCredentialProvider>.Instance);
    }

    /// <summary>
    /// The exact real Cloudflare Realtime TURN "generate-ice-servers" response shape:
    /// an array of one STUN-only entry and one TURN/TURNS entry with a short-lived
    /// username/credential, mirroring production evidence — not the incorrect single
    /// object this DTO used to assume.
    /// </summary>
    private static string ValidResponseJson()
    {
        return """
            {
              "iceServers": [
                {
                  "urls": [
                    "stun:stun.cloudflare.com:3478",
                    "stun:stun.cloudflare.com:53"
                  ]
                },
                {
                  "urls": [
                    "turn:turn.cloudflare.com:3478?transport=udp",
                    "turn:turn.cloudflare.com:53?transport=udp",
                    "turn:turn.cloudflare.com:3478?transport=tcp",
                    "turn:turn.cloudflare.com:80?transport=tcp",
                    "turns:turn.cloudflare.com:5349?transport=tcp",
                    "turns:turn.cloudflare.com:443?transport=tcp"
                  ],
                  "username": "generated-username",
                  "credential": "generated-credential"
                }
              ]
            }
            """;
    }
}
