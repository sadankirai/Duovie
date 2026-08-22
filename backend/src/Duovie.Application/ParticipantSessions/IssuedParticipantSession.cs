namespace Duovie.Application.ParticipantSessions;

public sealed record IssuedParticipantSession(
    string Credential,
    Guid RoomId,
    Guid ParticipantId,
    ParticipantRole Role,
    DateTimeOffset IssuedAtUtc,
    DateTimeOffset ExpiresAtUtc);
