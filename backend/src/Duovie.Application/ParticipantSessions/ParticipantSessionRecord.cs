namespace Duovie.Application.ParticipantSessions;

public sealed record ParticipantSessionRecord(
    Guid Id,
    Guid RoomId,
    Guid ParticipantId,
    ParticipantRole Role,
    byte[] TokenHash,
    DateTimeOffset IssuedAtUtc,
    DateTimeOffset ExpiresAtUtc);
