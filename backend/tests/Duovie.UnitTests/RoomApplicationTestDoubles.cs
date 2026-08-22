using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;

namespace Duovie.UnitTests;

internal sealed class RoomRepositorySpy : IRoomRepository
{
    private readonly Dictionary<Guid, Room> _rooms = [];

    public Room? AddedRoom { get; private set; }

    public int SaveChangesCallCount { get; private set; }

    public Exception? SaveChangesException { get; set; }

    public Task<Room?> GetByIdAsync(Guid roomId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _rooms.TryGetValue(roomId, out var room);

        return Task.FromResult(room);
    }

    public Task AddAsync(Room room, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        AddedRoom = room;
        _rooms.Add(room.Id, room);

        return Task.CompletedTask;
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveChangesCallCount++;

        if (SaveChangesException is not null)
        {
            throw SaveChangesException;
        }

        return Task.CompletedTask;
    }

    public void Seed(Room room)
    {
        _rooms.Add(room.Id, room);
    }
}

internal sealed class FixedTimeProvider(DateTimeOffset utcNow) : TimeProvider
{
    private DateTimeOffset _utcNow = utcNow;

    public override DateTimeOffset GetUtcNow()
    {
        return _utcNow;
    }

    public void SetUtcNow(DateTimeOffset utcNow)
    {
        _utcNow = utcNow;
    }
}
