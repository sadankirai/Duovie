using Duovie.Domain.Rooms;

namespace Duovie.Application.Rooms;

public sealed class JoinRoom(IRoomRepository roomRepository, TimeProvider timeProvider)
{
    private readonly IRoomRepository _roomRepository = roomRepository
        ?? throw new ArgumentNullException(nameof(roomRepository));

    private readonly TimeProvider _timeProvider = timeProvider
        ?? throw new ArgumentNullException(nameof(timeProvider));

    public async Task<Room> ExecuteAsync(
        Guid roomId,
        Guid guestId,
        CancellationToken cancellationToken = default)
    {
        var room = await _roomRepository.GetByIdAsync(roomId, cancellationToken)
            ?? throw new RoomNotFoundException(roomId);

        room.AddGuest(guestId, _timeProvider.GetUtcNow());
        await _roomRepository.SaveChangesAsync(cancellationToken);

        return room;
    }
}
