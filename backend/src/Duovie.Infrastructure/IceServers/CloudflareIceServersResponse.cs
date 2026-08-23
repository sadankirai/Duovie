namespace Duovie.Infrastructure.IceServers;

/// <summary>
/// Raw Cloudflare Realtime TURN "generate-ice-servers" response shape. Untrusted until
/// validated by <see cref="CloudflareTurnCredentialProvider"/> — never returned as-is.
/// </summary>
internal sealed class CloudflareIceServersResponse
{
    /// <summary>
    /// Cloudflare returns an array here — typically one STUN-only entry and one TURN/TURNS
    /// entry with a short-lived username/credential — never a single object.
    /// </summary>
    public IReadOnlyList<CloudflareIceServerEntry>? IceServers { get; init; }
}

internal sealed class CloudflareIceServerEntry
{
    public IReadOnlyList<string>? Urls { get; init; }

    public string? Username { get; init; }

    public string? Credential { get; init; }
}
