using Duovie.Application.ParticipantSessions;

namespace Duovie.Api.Realtime;

public sealed record RoomHubConnectionIdentity(
    Guid RoomId,
    Guid ParticipantId,
    ParticipantRole Role)
{
    public RoomPresenceParticipant ToPresenceParticipant(bool connected)
    {
        return new RoomPresenceParticipant(ParticipantId, Role.ToString(), connected);
    }
}
