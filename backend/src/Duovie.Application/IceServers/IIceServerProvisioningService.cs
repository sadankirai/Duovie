namespace Duovie.Application.IceServers;

/// <summary>
/// Provider-neutral source of WebRTC ICE server configuration (baseline STUN plus any
/// short-lived TURN credentials). Implementations must never surface provider-specific
/// details (HTTP mechanics, long-lived secrets) through this abstraction.
/// </summary>
public interface IIceServerProvisioningService
{
    Task<IReadOnlyList<IceServerDescriptor>> GetIceServersAsync(
        CancellationToken cancellationToken = default);
}
