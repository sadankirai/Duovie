namespace Duovie.Api.Contracts.IceServers;

public sealed record IceServersResponse(IReadOnlyList<IceServerResponse> IceServers);

public sealed record IceServerResponse(
    IReadOnlyList<string> Urls,
    string? Username,
    string? Credential);
