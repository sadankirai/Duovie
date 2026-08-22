using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;

namespace Duovie.UnitTests;

public class CloseRoomTests
{
    private static readonly Guid RoomId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid HostId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly DateTimeOffset CreatedAtUtc = new(2026, 8, 22, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ExpiresAtUtc = CreatedAtUtc.AddHours(2);

    [Fact]
    public async Task ExecuteAsync_closes_an_existing_room_and_persists_the_change()
    {
        var room = CreateRoom();
        var repository = CreateRepository(room);
        var closedAtUtc = CreatedAtUtc.AddMinutes(10);
        var useCase = new CloseRoom(repository, new FixedTimeProvider(closedAtUtc));

        var result = await useCase.ExecuteAsync(RoomId);

        Assert.Same(room, result);
        Assert.Equal(RoomStatus.Closed, room.Status);
        Assert.Equal(closedAtUtc, room.ClosedAtUtc);
        Assert.Equal(1, repository.SaveChangesCallCount);
    }

    [Fact]
    public async Task ExecuteAsync_reports_a_missing_room_distinctly()
    {
        var repository = new RoomRepositorySpy();
        var useCase = new CloseRoom(repository, new FixedTimeProvider(CreatedAtUtc.AddMinutes(10)));

        var exception = await Assert.ThrowsAsync<RoomNotFoundException>(
            () => useCase.ExecuteAsync(RoomId));

        Assert.Equal(RoomId, exception.RoomId);
        Assert.Equal(0, repository.SaveChangesCallCount);
    }

    [Fact]
    public async Task ExecuteAsync_repeated_close_preserves_the_first_close_time()
    {
        var room = CreateRoom();
        var repository = CreateRepository(room);
        var firstCloseUtc = CreatedAtUtc.AddMinutes(10);
        var timeProvider = new FixedTimeProvider(firstCloseUtc);
        var useCase = new CloseRoom(repository, timeProvider);

        await useCase.ExecuteAsync(RoomId);
        timeProvider.SetUtcNow(firstCloseUtc.AddMinutes(1));
        await useCase.ExecuteAsync(RoomId);

        Assert.Equal(firstCloseUtc, room.ClosedAtUtc);
        Assert.Equal(2, repository.SaveChangesCallCount);
    }

    private static Room CreateRoom()
    {
        return Room.Create(RoomId, HostId, CreatedAtUtc, ExpiresAtUtc);
    }

    private static RoomRepositorySpy CreateRepository(Room room)
    {
        var repository = new RoomRepositorySpy();
        repository.Seed(room);

        return repository;
    }
}
