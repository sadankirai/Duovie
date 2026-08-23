using Duovie.Infrastructure.IceServers;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Duovie.IntegrationTests;

public sealed class IceServerProvisioningServiceTests
{
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
