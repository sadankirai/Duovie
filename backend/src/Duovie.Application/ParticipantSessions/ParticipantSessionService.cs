using System.Buffers.Text;
using System.Security.Cryptography;

namespace Duovie.Application.ParticipantSessions;

public sealed class ParticipantSessionService(
    IParticipantSessionStore sessionStore,
    ParticipantSessionOptions options,
    TimeProvider timeProvider)
{
    private const int TokenByteLength = 32;
    private static readonly int EncodedTokenLength = Base64Url.GetEncodedLength(TokenByteLength);

    private readonly IParticipantSessionStore _sessionStore = sessionStore
        ?? throw new ArgumentNullException(nameof(sessionStore));

    private readonly ParticipantSessionOptions _options = options
        ?? throw new ArgumentNullException(nameof(options));

    private readonly TimeProvider _timeProvider = timeProvider
        ?? throw new ArgumentNullException(nameof(timeProvider));

    public async Task<IssuedParticipantSession> IssueAsync(
        Guid roomId,
        Guid participantId,
        ParticipantRole role,
        CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfEqual(roomId, Guid.Empty);
        ArgumentOutOfRangeException.ThrowIfEqual(participantId, Guid.Empty);

        if (!Enum.IsDefined(role))
        {
            throw new ArgumentOutOfRangeException(nameof(role));
        }

        var tokenBytes = RandomNumberGenerator.GetBytes(TokenByteLength);

        try
        {
            var issuedAtUtc = _timeProvider.GetUtcNow();
            var expiresAtUtc = issuedAtUtc.Add(_options.Lifetime);
            var credential = Base64Url.EncodeToString(tokenBytes);
            var tokenHash = SHA256.HashData(tokenBytes);
            var session = new ParticipantSessionRecord(
                Guid.NewGuid(),
                roomId,
                participantId,
                role,
                tokenHash,
                issuedAtUtc,
                expiresAtUtc);

            await _sessionStore.AddAsync(session, cancellationToken);
            await _sessionStore.SaveChangesAsync(cancellationToken);

            return new IssuedParticipantSession(
                credential,
                roomId,
                participantId,
                role,
                issuedAtUtc,
                expiresAtUtc);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(tokenBytes);
        }
    }

    public async Task<ValidatedParticipantSession> ValidateAsync(
        string? credential,
        Guid expectedRoomId,
        CancellationToken cancellationToken = default)
    {
        if (expectedRoomId == Guid.Empty
            || string.IsNullOrWhiteSpace(credential)
            || credential.Length != EncodedTokenLength
            || !Base64Url.IsValid(credential))
        {
            throw new ParticipantSessionInvalidException();
        }

        var tokenBytes = new byte[TokenByteLength];

        try
        {
            if (!Base64Url.TryDecodeFromChars(credential, tokenBytes, out var bytesWritten)
                || bytesWritten != TokenByteLength)
            {
                throw new ParticipantSessionInvalidException();
            }

            var tokenHash = SHA256.HashData(tokenBytes);
            var session = await _sessionStore.GetByTokenHashAsync(tokenHash, cancellationToken);

            if (session is null
                || session.RoomId != expectedRoomId
                || _timeProvider.GetUtcNow() >= session.ExpiresAtUtc)
            {
                throw new ParticipantSessionInvalidException();
            }

            return new ValidatedParticipantSession(
                session.RoomId,
                session.ParticipantId,
                session.Role);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(tokenBytes);
        }
    }
}
