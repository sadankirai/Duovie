using Duovie.Application.Rooms;
using Duovie.Infrastructure;
using Duovie.Infrastructure.Persistence;
using Duovie.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using System.Xml.Linq;

namespace Duovie.IntegrationTests;

public class ApiCompositionTests
{
    [Fact]
    public void Api_references_the_Application_and_Infrastructure_layers()
    {
        var references = GetProjectReferences("backend/src/Duovie.Api/Duovie.Api.csproj");

        Assert.Equal(2, references.Count);
        Assert.Contains(references, reference => reference.Contains("Duovie.Application.csproj", StringComparison.Ordinal));
        Assert.Contains(references, reference => reference.Contains("Duovie.Infrastructure.csproj", StringComparison.Ordinal));
        Assert.DoesNotContain(references, reference => reference.Contains("Duovie.Domain.csproj", StringComparison.Ordinal));
    }

    [Fact]
    public void Infrastructure_requires_the_default_connection_string()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();

        var exception = Assert.Throws<InvalidOperationException>(() => services.AddInfrastructure(configuration));

        Assert.Equal("Connection string 'DefaultConnection' is required.", exception.Message);
    }

    [Fact]
    public void Infrastructure_registers_DuovieDbContext_with_the_PostgreSQL_provider()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:DefaultConnection"] = "Host=127.0.0.1;Port=5433;Database=duovie;Username=duovie",
                })
            .Build();

        services.AddInfrastructure(configuration);

        using var serviceProvider = services.BuildServiceProvider();
        using var scope = serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DuovieDbContext>();

        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", dbContext.Database.ProviderName);
    }

    [Fact]
    public void Infrastructure_registers_the_Room_repository()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:DefaultConnection"] = "Host=127.0.0.1;Port=5433;Database=duovie;Username=duovie",
                })
            .Build();

        services.AddInfrastructure(configuration);

        using var serviceProvider = services.BuildServiceProvider();
        using var scope = serviceProvider.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<IRoomRepository>();

        Assert.IsType<RoomRepository>(repository);
    }

    private static IReadOnlyList<string> GetProjectReferences(string relativeProjectPath)
    {
        var projectPath = Path.Combine(FindRepositoryRoot(), relativeProjectPath);
        var project = XDocument.Load(projectPath);

        return project
            .Descendants("ProjectReference")
            .Select(reference => reference.Attribute("Include")?.Value)
            .OfType<string>()
            .ToList();
    }

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "backend", "Duovie.sln")))
            {
                return directory.FullName;
            }
        }

        throw new DirectoryNotFoundException("Could not find the repository root.");
    }
}
