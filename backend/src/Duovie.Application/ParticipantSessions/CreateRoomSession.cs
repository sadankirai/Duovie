using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;

namespace Duovie.Application.ParticipantSessions;

public sealed record CreateRoomSessionResult(Room Room, IssuedParticipantSession Session);

public sealed class CreateRoomSession(
    CreateRoom createRoom,
    ParticipantSessionService sessionService,
    IRoomSessionTransaction transaction)
{
    private readonly CreateRoom _createRoom = createRoom
        ?? throw new ArgumentNullException(nameof(createRoom));

    private readonly ParticipantSessionService _sessionService = sessionService
        ?? throw new ArgumentNullException(nameof(sessionService));

    private readonly IRoomSessionTransaction _transaction = transaction
        ?? throw new ArgumentNullException(nameof(transaction));

    public Task<CreateRoomSessionResult> ExecuteAsync(
        DateTimeOffset roomExpiresAtUtc,
        CancellationToken cancellationToken = default)
    {
        return _transaction.ExecuteAsync(
            async operationCancellationToken =>
            {
                var hostId = Guid.NewGuid();
                var room = await _createRoom.ExecuteAsync(
                    hostId,
                    roomExpiresAtUtc,
                    operationCancellationToken);
                var session = await _sessionService.IssueAsync(
                    room.Id,
                    hostId,
                    ParticipantRole.Host,
                    operationCancellationToken);

                return new CreateRoomSessionResult(room, session);
            },
            cancellationToken);
    }
}
