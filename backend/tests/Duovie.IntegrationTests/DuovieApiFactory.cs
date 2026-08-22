using Duovie.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Duovie.IntegrationTests;

public sealed class DuovieApiFactory : WebApplicationFactory<Program>
{
    private const string UnreachableConnectionString = "Host=127.0.0.1;Port=1;Database=duovie;Username=duovie;Timeout=1;Command Timeout=1";
    private const string SessionLifetime = "00:30:00";
    private const string RoomLifetime = "02:00:00";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:DefaultConnection", UnreachableConnectionString);
        builder.UseSetting("ParticipantSessions:Lifetime", SessionLifetime);
        builder.UseSetting("Rooms:Lifetime", RoomLifetime);
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.Sources.Clear();
            configuration.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:DefaultConnection"] = UnreachableConnectionString,
                    ["ParticipantSessions:Lifetime"] = SessionLifetime,
                    ["Rooms:Lifetime"] = RoomLifetime,
                });
        });
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DuovieDbContext>();
            services.RemoveAll<DbContextOptions<DuovieDbContext>>();
            services.AddDbContext<DuovieDbContext>(options => options.UseNpgsql(UnreachableConnectionString));
        });
    }
}
