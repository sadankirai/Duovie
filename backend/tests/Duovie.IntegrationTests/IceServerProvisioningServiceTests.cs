using System.Net;
using Duovie.Infrastructure.IceServers;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Duovie.IntegrationTests;

public sealed class IceServerProvisioningServiceTests
{
    [Fact]
    public async Task Composed_result_preserves_configured_baseline_STUN_and_both_real_shape_Cloudflare_entries()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """
            {
              "iceServers": [
                { "urls": ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
                {
                  "urls": [
                    "turn:turn.cloudflare.com:3478?transport=udp",
                    "turns:turn.cloudflare.com:5349?transport=tcp"
                  ],
                  "username": "generated-username",
                  "credential": "generated-credential"
                }
              ]
            }
            """));
        var httpClient = new HttpClient(handler)
        {
            BaseAddress = new Uri("https://rtc.live.cloudflare.com/"),
        };
        var turnProvider = new CloudflareTurnCredentialProvider(
            httpClient,
            Options.Create(new CloudflareTurnOptions
            {
                Enabled = true,
                KeyId = "test-key-id",
                ApiToken = "test-token",
            }),
            NullLogger<CloudflareTurnCredentialProvider>.Instance);
        var iceServerOptions = Options.Create(new IceServerOptions
        {
            StunUrls = ["stun:configured-baseline.example.com:3478"],
        });
        var service = new IceServerProvisioningService(iceServerOptions, turnProvider);

        var result = await service.GetIceServersAsync();

        Assert.Equal(3, result.Count);
        Assert.Equal(["stun:configured-baseline.example.com:3478"], result[0].Urls);
        Assert.Equal(
            ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"],
            result[1].Urls);
        Assert.Null(result[1].Username);
        Assert.Equal(
            [
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turns:turn.cloudflare.com:5349?transport=tcp",
            ],
            result[2].Urls);
        Assert.Equal("generated-username", result[2].Username);
        Assert.Equal("generated-credential", result[2].Credential);
    }

    [Fact]
    public async Task Baseline_STUN_is_still_returned_when_TURN_credential_generation_times_out()
    {
        var handler = new FakeHttpMessageHandler { Hang = true };
        var httpClient = new HttpClient(handler)
        {
            BaseAddress = new Uri("https://rtc.live.cloudflare.com/"),
            Timeout = TimeSpan.FromMilliseconds(30),
        };
        var cloudflareOptions = Options.Create(new CloudflareTurnOptions
        {
            Enabled = true,
            KeyId = "test-key-id",
            ApiToken = "test-token",
        });
        var turnProvider = new CloudflareTurnCredentialProvider(
            httpClient,
            cloudflareOptions,
            NullLogger<CloudflareTurnCredentialProvider>.Instance);
        var iceServerOptions = Options.Create(new IceServerOptions
        {
            StunUrls = ["stun:stun.cloudflare.com:3478"],
        });
        var service = new IceServerProvisioningService(iceServerOptions, turnProvider);

        var result = await service.GetIceServersAsync();

        var baseline = Assert.Single(result);
        Assert.Equal(["stun:stun.cloudflare.com:3478"], baseline.Urls);
    }
}
