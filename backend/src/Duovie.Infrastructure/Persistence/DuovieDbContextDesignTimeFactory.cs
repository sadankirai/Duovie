using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Duovie.Infrastructure.Persistence;

/// <summary>
/// Creates the context for Entity Framework Core tooling without composing the API runtime host.
/// </summary>
public sealed class DuovieDbContextDesignTimeFactory : IDesignTimeDbContextFactory<DuovieDbContext>
{
    private const string ModelInspectionConnectionString =
        "Host=localhost;Database=duovie_design_time;Username=duovie";

    public DuovieDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            connectionString = ModelInspectionConnectionString;
        }

        var options = new DbContextOptionsBuilder<DuovieDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new DuovieDbContext(options);
    }
}
