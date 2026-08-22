using Duovie.Application.Rooms;

namespace Duovie.Application.ParticipantSessions;

public sealed class ParticipantSessionAuthorizer(
    ParticipantSessionService sessionService,
    IRoomRepository roomRepository)
{
    private readonly ParticipantSessionService _sessionService = sessionService
        ?? throw new ArgumentNullException(nameof(sessionService));

    private readonly IRoomRepository _roomRepository = roomRepository
        ?? throw new ArgumentNullException(nameof(roomRepository));

    public async Task<ValidatedParticipantSession> RequireHostAsync(
        string? credential,
        Guid expectedRoomId,
        CancellationToken cancellationToken = default)
    {
        var session = await _sessionService.ValidateAsync(
            credential,
            expectedRoomId,
            cancellationToken);

        if (session.Role != ParticipantRole.Host)
        {
            throw new ParticipantSessionAuthorizationException();
        }

        var room = await _roomRepository.GetByIdAsync(expectedRoomId, cancellationToken);

        if (room is null || room.HostId != session.ParticipantId)
        {
            throw new ParticipantSessionAuthorizationException();
        }

        return session;
    }
}
