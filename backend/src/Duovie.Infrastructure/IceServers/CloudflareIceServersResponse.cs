namespace Duovie.Infrastructure.IceServers;

/// <summary>
/// Raw Cloudflare Realtime TURN "generate-ice-servers" response shape. Untrusted until
/// validated by <see cref="CloudflareTurnCredentialProvider"/> — never returned as-is.
/// </summary>
internal sealed class CloudflareIceServersResponse
{
    public CloudflareIceServerEntry? IceServers { get; init; }
}

internal sealed class CloudflareIceServerEntry
{
    public IReadOnlyList<string>? Urls { get; init; }

    public string? Username { get; init; }

    public string? Credential { get; init; }
}
