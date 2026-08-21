using System.Xml.Linq;

namespace Duovie.UnitTests;

public class ArchitectureDependencyTests
{
    [Fact]
    public void Domain_does_not_reference_another_Duovie_project()
    {
        var references = GetProjectReferences("backend/src/Duovie.Domain/Duovie.Domain.csproj");

        Assert.Empty(references);
    }

    [Fact]
    public void Application_references_Domain()
    {
        var references = GetProjectReferences("backend/src/Duovie.Application/Duovie.Application.csproj");

        var domainReference = Assert.Single(references);
        Assert.Contains("Duovie.Domain.csproj", domainReference, StringComparison.Ordinal);
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
