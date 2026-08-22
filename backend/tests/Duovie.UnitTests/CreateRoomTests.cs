using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;

namespace Duovie.UnitTests;

public class CreateRoomTests
{
    private static readonly Guid HostId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly DateTimeOffset CreatedAtUtc = new(2026, 8, 22, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ExpiresAtUtc = CreatedAtUtc.AddHours(2);

    [Fact]
    public async Task ExecuteAsync_creates_a_valid_waiting_room()
    {
        var repository = new RoomRepositorySpy();
        var useCase = new CreateRoom(repository, new FixedTimeProvider(CreatedAtUtc));

        var room = await useCase.ExecuteAsync(HostId, ExpiresAtUtc);

        Assert.NotEqual(Guid.Empty, room.Id);
        Assert.Equal(HostId, room.HostId);
        Assert.Null(room.GuestId);
        Assert.Equal(RoomStatus.WaitingForGuest, room.Status);
        Assert.Equal(CreatedAtUtc, room.CreatedAtUtc);
        Assert.Equal(ExpiresAtUtc, room.ExpiresAtUtc);
    }

    [Fact]
    public async Task ExecuteAsync_adds_and_persists_the_created_room()
    {
        var repository = new RoomRepositorySpy();
        var useCase = new CreateRoom(repository, new FixedTimeProvider(CreatedAtUtc));

        var room = await useCase.ExecuteAsync(HostId, ExpiresAtUtc);

        Assert.Same(room, repository.AddedRoom);
        Assert.Equal(1, repository.SaveChangesCallCount);
    }

    [Fact]
    public async Task ExecuteAsync_uses_the_supplied_time_provider()
    {
        var repository = new RoomRepositorySpy();
        var useCase = new CreateRoom(repository, new FixedTimeProvider(CreatedAtUtc));

        var room = await useCase.ExecuteAsync(HostId, ExpiresAtUtc);

        Assert.Equal(CreatedAtUtc, room.CreatedAtUtc);
    }

    [Fact]
    public async Task ExecuteAsync_propagates_invalid_expiration_from_the_Domain()
    {
        var repository = new RoomRepositorySpy();
        var useCase = new CreateRoom(repository, new FixedTimeProvider(CreatedAtUtc));

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => useCase.ExecuteAsync(HostId, CreatedAtUtc));

        Assert.Null(repository.AddedRoom);
        Assert.Equal(0, repository.SaveChangesCallCount);
    }
}
