using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;

namespace Duovie.Application.ParticipantSessions;

public sealed record JoinRoomSessionResult(Room Room, IssuedParticipantSession Session);

public sealed class JoinRoomSession(
    JoinRoom joinRoom,
    ParticipantSessionService sessionService,
    IRoomSessionTransaction transaction)
{
    private readonly JoinRoom _joinRoom = joinRoom
        ?? throw new ArgumentNullException(nameof(joinRoom));

    private readonly ParticipantSessionService _sessionService = sessionService
        ?? throw new ArgumentNullException(nameof(sessionService));

    private readonly IRoomSessionTransaction _transaction = transaction
        ?? throw new ArgumentNullException(nameof(transaction));

    public Task<JoinRoomSessionResult> ExecuteAsync(
        Guid roomId,
        CancellationToken cancellationToken = default)
    {
        return _transaction.ExecuteAsync(
            async operationCancellationToken =>
            {
                var guestId = Guid.NewGuid();
                var room = await _joinRoom.ExecuteAsync(
                    roomId,
                    guestId,
                    operationCancellationToken);
                var session = await _sessionService.IssueAsync(
                    room.Id,
                    guestId,
                    ParticipantRole.Guest,
                    operationCancellationToken);

                return new JoinRoomSessionResult(room, session);
            },
            cancellationToken);
    }
}
