namespace Duovie.Infrastructure.IceServers;

/// <summary>
/// Baseline ICE server configuration (currently STUN only). Empty by default so local
/// development and E2E never depend on external network access.
/// </summary>
public sealed class IceServerOptions
{
    public const string ConfigurationSectionName = "IceServers";

    public IReadOnlyList<string> StunUrls { get; init; } = [];
}
