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

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.Sources.Clear();
            configuration.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:DefaultConnection"] = UnreachableConnectionString,
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
