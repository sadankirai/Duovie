namespace Duovie.Application.ParticipantSessions;

public sealed record ValidatedParticipantSession(
    Guid RoomId,
    Guid ParticipantId,
    ParticipantRole Role);
