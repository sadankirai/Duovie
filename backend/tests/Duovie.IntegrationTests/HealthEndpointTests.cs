using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Duovie.IntegrationTests;

public class HealthEndpointTests(DuovieApiFactory factory) : IClassFixture<DuovieApiFactory>
{
    [Fact]
    public async Task Liveness_is_healthy_when_the_database_is_unreachable()
    {
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
        });

        var response = await client.GetAsync("/health/live");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Readiness_is_unhealthy_when_the_database_is_unreachable()
    {
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
        });

        var response = await client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }
}
