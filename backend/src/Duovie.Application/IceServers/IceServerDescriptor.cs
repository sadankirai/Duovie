namespace Duovie.Application.IceServers;

public sealed record IceServerDescriptor(
    IReadOnlyList<string> Urls,
    string? Username = null,
    string? Credential = null);
