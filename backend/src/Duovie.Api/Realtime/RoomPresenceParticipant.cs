namespace Duovie.Api.Realtime;

public sealed record RoomPresenceParticipant(
    Guid ParticipantId,
    string Role,
    bool Connected);

public sealed record RoomPresenceSnapshot(IReadOnlyList<RoomPresenceParticipant> Participants);
