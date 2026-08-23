namespace Duovie.Infrastructure.IceServers;

/// <summary>
/// Server-only Cloudflare Realtime TURN configuration. <see cref="ApiToken"/> is the
/// long-lived provider secret and must never reach the browser or be logged.
/// </summary>
public sealed class CloudflareTurnOptions
{
    public const string ConfigurationSectionName = "CloudflareTurn";

    /// <summary>
    /// Default short-lived TURN credential TTL. The development/E2E Room lifetime is
    /// approximately two hours (<c>Rooms:Lifetime</c>); four hours gives a comfortable
    /// margin over that so a Room fetched once at Hub-connect time never outlives its
    /// TURN credential. Operators with a longer configured Room lifetime should raise
    /// this value accordingly. Mid-call refresh is intentionally out of scope while the
    /// TTL safely covers the Room lifetime; a future Room could refresh credentials with
    /// <c>RTCPeerConnection.setConfiguration</c> if that ever changes.
    /// </summary>
    public const int DefaultCredentialTtlSeconds = 14_400;

    public bool Enabled { get; init; }

    public string? KeyId { get; init; }

    public string? ApiToken { get; init; }

    public int CredentialTtlSeconds { get; init; } = DefaultCredentialTtlSeconds;
}
