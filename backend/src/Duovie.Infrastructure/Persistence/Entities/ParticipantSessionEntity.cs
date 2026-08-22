using Duovie.Application.ParticipantSessions;

namespace Duovie.Infrastructure.Persistence.Entities;

public sealed class ParticipantSessionEntity
{
    private ParticipantSessionEntity()
    {
    }

    public ParticipantSessionEntity(
        Guid id,
        Guid roomId,
        Guid participantId,
        ParticipantRole role,
        byte[] tokenHash,
        DateTimeOffset issuedAtUtc,
        DateTimeOffset expiresAtUtc)
    {
        Id = id;
        RoomId = roomId;
        ParticipantId = participantId;
        Role = role;
        TokenHash = tokenHash ?? throw new ArgumentNullException(nameof(tokenHash));
        IssuedAtUtc = issuedAtUtc;
        ExpiresAtUtc = expiresAtUtc;
    }

    public Guid Id { get; private set; }

    public Guid RoomId { get; private set; }

    public Guid ParticipantId { get; private set; }

    public ParticipantRole Role { get; private set; }

    public byte[] TokenHash { get; private set; } = [];

    public DateTimeOffset IssuedAtUtc { get; private set; }

    public DateTimeOffset ExpiresAtUtc { get; private set; }
}
