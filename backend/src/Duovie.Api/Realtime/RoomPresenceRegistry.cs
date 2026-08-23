using Duovie.Application.ParticipantSessions;

namespace Duovie.Api.Realtime;

public sealed class RoomPresenceRegistry : IRoomPresenceRegistry
{
    private readonly object _gate = new();
    private readonly Dictionary<ParticipantKey, HashSet<string>> _connections = [];

    public bool Add(RoomHubConnectionIdentity participant, string connectionId)
    {
        ArgumentNullException.ThrowIfNull(participant);
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionId);

        var key = new ParticipantKey(participant.RoomId, participant.ParticipantId, participant.Role);

        lock (_gate)
        {
            if (!_connections.TryGetValue(key, out var connectionIds))
            {
                connectionIds = [];
                _connections.Add(key, connectionIds);
            }

            return connectionIds.Add(connectionId) && connectionIds.Count == 1;
        }
    }

    public bool Remove(RoomHubConnectionIdentity participant, string connectionId)
    {
        ArgumentNullException.ThrowIfNull(participant);
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionId);

        var key = new ParticipantKey(participant.RoomId, participant.ParticipantId, participant.Role);

        lock (_gate)
        {
            if (!_connections.TryGetValue(key, out var connectionIds)
                || !connectionIds.Remove(connectionId))
            {
                return false;
            }

            if (connectionIds.Count != 0)
            {
                return false;
            }

            _connections.Remove(key);
            return true;
        }
    }

    public IReadOnlyList<RoomPresenceParticipant> GetSnapshot(Guid roomId)
    {
        lock (_gate)
        {
            return _connections.Keys
                .Where(key => key.RoomId == roomId)
                .OrderBy(key => key.Role)
                .ThenBy(key => key.ParticipantId)
                .Select(key => new RoomPresenceParticipant(
                    key.ParticipantId,
                    key.Role.ToString(),
                    Connected: true))
                .ToArray();
        }
    }

    private sealed record ParticipantKey(
        Guid RoomId,
        Guid ParticipantId,
        ParticipantRole Role);
}
