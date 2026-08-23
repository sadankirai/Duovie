using System.Globalization;
using Duovie.Application.IceServers;
using Duovie.Application.ParticipantSessions;
using Duovie.Application.Rooms;
using Duovie.Infrastructure.IceServers;
using Duovie.Infrastructure.Persistence;
using Duovie.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Duovie.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection");

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("Connection string 'DefaultConnection' is required.");
        }

        var lifetimeValue = configuration[ParticipantSessionOptions.LifetimeConfigurationKey];

        if (!TimeSpan.TryParse(lifetimeValue, CultureInfo.InvariantCulture, out var lifetime)
            || lifetime <= TimeSpan.Zero)
        {
            throw new InvalidOperationException(
                $"Configuration value '{ParticipantSessionOptions.LifetimeConfigurationKey}' must be a positive TimeSpan.");
        }

        services.AddDbContext<DuovieDbContext>(options => options.UseNpgsql(connectionString));
        services.AddSingleton(new ParticipantSessionOptions(lifetime));
        services.AddSingleton(TimeProvider.System);
        services.AddScoped<IRoomRepository, RoomRepository>();
        services.AddScoped<IParticipantSessionStore, ParticipantSessionStore>();
        services.AddScoped<IRoomSessionTransaction, RoomSessionTransaction>();
        services.AddScoped<CreateRoom>();
        services.AddScoped<JoinRoom>();
        services.AddScoped<ParticipantSessionService>();
        services.AddScoped<ParticipantSessionAuthorizer>();
        services.AddScoped<CreateRoomSession>();
        services.AddScoped<JoinRoomSession>();

        services.AddOptions<IceServerOptions>()
            .Bind(configuration.GetSection(IceServerOptions.ConfigurationSectionName));

        services.AddOptions<CloudflareTurnOptions>()
            .Bind(configuration.GetSection(CloudflareTurnOptions.ConfigurationSectionName))
            .Validate(
                cloudflareOptions => !cloudflareOptions.Enabled
                    || (!string.IsNullOrWhiteSpace(cloudflareOptions.KeyId)
                        && !string.IsNullOrWhiteSpace(cloudflareOptions.ApiToken)),
                $"Configuration values '{CloudflareTurnOptions.ConfigurationSectionName}:KeyId' and " +
                $"'{CloudflareTurnOptions.ConfigurationSectionName}:ApiToken' are required when " +
                $"'{CloudflareTurnOptions.ConfigurationSectionName}:Enabled' is true.")
            .Validate(
                cloudflareOptions => cloudflareOptions.CredentialTtlSeconds > 0,
                $"Configuration value '{CloudflareTurnOptions.ConfigurationSectionName}:CredentialTtlSeconds' " +
                "must be positive.")
            .ValidateOnStart();

        services.AddHttpClient<CloudflareTurnCredentialProvider>(client =>
        {
            client.BaseAddress = new Uri("https://rtc.live.cloudflare.com/");
            client.Timeout = TimeSpan.FromSeconds(5);
        });
        services.AddScoped<IIceServerProvisioningService, IceServerProvisioningService>();

        return services;
    }
}
