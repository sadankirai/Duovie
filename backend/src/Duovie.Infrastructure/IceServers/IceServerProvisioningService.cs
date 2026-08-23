using Duovie.Application.IceServers;
using Microsoft.Extensions.Options;

namespace Duovie.Infrastructure.IceServers;

/// <summary>
/// Combines configured baseline STUN with Cloudflare TURN credentials, when enabled and
/// available. A TURN provider failure degrades to baseline-only; it never throws.
/// </summary>
public sealed class IceServerProvisioningService(
    IOptions<IceServerOptions> iceServerOptions,
    CloudflareTurnCredentialProvider turnCredentialProvider) : IIceServerProvisioningService
{
    private readonly IceServerOptions _iceServerOptions = iceServerOptions?.Value
        ?? throw new ArgumentNullException(nameof(iceServerOptions));

    private readonly CloudflareTurnCredentialProvider _turnCredentialProvider = turnCredentialProvider
        ?? throw new ArgumentNullException(nameof(turnCredentialProvider));

    public async Task<IReadOnlyList<IceServerDescriptor>> GetIceServersAsync(
        CancellationToken cancellationToken = default)
    {
        var servers = new List<IceServerDescriptor>();

        if (_iceServerOptions.StunUrls.Count > 0)
        {
            servers.Add(new IceServerDescriptor(_iceServerOptions.StunUrls));
        }

        var turnServers = await _turnCredentialProvider.GetTurnServersAsync(cancellationToken);
        servers.AddRange(turnServers);

        return servers;
    }
}
