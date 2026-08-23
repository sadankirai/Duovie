namespace Duovie.Api.Realtime;

public interface IRoomPresenceRegistry
{
    bool Add(RoomHubConnectionIdentity participant, string connectionId);

    bool Remove(RoomHubConnectionIdentity participant, string connectionId);

    IReadOnlyList<RoomPresenceParticipant> GetSnapshot(Guid roomId);
}
