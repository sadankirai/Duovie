using Duovie.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Testcontainers.PostgreSql;

namespace Duovie.IntegrationTests;

[CollectionDefinition(Name)]
public sealed class PostgreSqlCollection : ICollectionFixture<PostgreSqlFixture>
{
    public const string Name = "PostgreSQL persistence";
}

public sealed class PostgreSqlFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:18")
        .WithDatabase("duovie_tests")
        .WithUsername("duovie")
        .WithPassword($"duovie_{Guid.NewGuid():N}")
        .Build();

    public DuovieDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<DuovieDbContext>()
            .UseNpgsql(_container.GetConnectionString())
            .Options;

        return new DuovieDbContext(options);
    }

    public async Task InitializeAsync()
    {
        await _container.StartAsync();

        await using var dbContext = CreateDbContext();
        await dbContext.Database.MigrateAsync();
    }

    public Task DisposeAsync()
    {
        return _container.DisposeAsync().AsTask();
    }
}
