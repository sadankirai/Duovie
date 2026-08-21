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
