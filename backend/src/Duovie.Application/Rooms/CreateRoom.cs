using Duovie.Domain.Rooms;

namespace Duovie.Application.Rooms;

public sealed class CreateRoom(IRoomRepository roomRepository, TimeProvider timeProvider)
{
    private readonly IRoomRepository _roomRepository = roomRepository
        ?? throw new ArgumentNullException(nameof(roomRepository));

    private readonly TimeProvider _timeProvider = timeProvider
        ?? throw new ArgumentNullException(nameof(timeProvider));

    public async Task<Room> ExecuteAsync(
        Guid hostId,
        DateTimeOffset expiresAtUtc,
        CancellationToken cancellationToken = default)
    {
        var room = Room.Create(
            Guid.NewGuid(),
            hostId,
            _timeProvider.GetUtcNow(),
            expiresAtUtc);

        await _roomRepository.AddAsync(room, cancellationToken);
        await _roomRepository.SaveChangesAsync(cancellationToken);

        return room;
    }
}
