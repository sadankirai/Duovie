using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Options;

namespace Duovie.IntegrationTests;

public sealed class RoomHttpConfigurationTests
{
    [Fact]
    public void Api_rejects_a_non_positive_Room_lifetime_at_startup()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Testing");
                builder.UseSetting(
                    "ConnectionStrings:DefaultConnection",
                    "Host=127.0.0.1;Port=1;Database=duovie;Username=duovie");
                builder.UseSetting("ParticipantSessions:Lifetime", "00:30:00");
                builder.UseSetting("Rooms:Lifetime", "00:00:00");
            });

        var exception = Assert.Throws<OptionsValidationException>(() => factory.CreateClient());

        Assert.Contains(
            exception.Failures,
            failure => failure.Contains("Rooms:Lifetime", StringComparison.Ordinal));
    }

    [Fact]
    public void Api_rejects_CloudflareTurn_enabled_without_required_secrets_at_startup()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Testing");
                builder.UseSetting(
                    "ConnectionStrings:DefaultConnection",
                    "Host=127.0.0.1;Port=1;Database=duovie;Username=duovie");
                builder.UseSetting("ParticipantSessions:Lifetime", "00:30:00");
                builder.UseSetting("Rooms:Lifetime", "02:00:00");
                builder.UseSetting("CloudflareTurn:Enabled", "true");
            });

        var exception = Assert.Throws<OptionsValidationException>(() => factory.CreateClient());

        Assert.Contains(
            exception.Failures,
            failure => failure.Contains("CloudflareTurn:KeyId", StringComparison.Ordinal)
                && failure.Contains("CloudflareTurn:ApiToken", StringComparison.Ordinal));
    }
}
