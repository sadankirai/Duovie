using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;

namespace Duovie.UnitTests;

public class JoinRoomTests
{
    private static readonly Guid RoomId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid HostId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid GuestId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid SecondGuestId = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly DateTimeOffset CreatedAtUtc = new(2026, 8, 22, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ExpiresAtUtc = CreatedAtUtc.AddHours(2);

    [Fact]
    public async Task ExecuteAsync_joins_an_active_room_and_persists_the_change()
    {
        var room = CreateRoom();
        var repository = CreateRepository(room);
        var useCase = new JoinRoom(repository, new FixedTimeProvider(CreatedAtUtc.AddMinutes(1)));

        var result = await useCase.ExecuteAsync(RoomId, GuestId);

        Assert.Same(room, result);
        Assert.Equal(GuestId, room.GuestId);
        Assert.Equal(RoomStatus.Ready, room.Status);
        Assert.Equal(1, repository.SaveChangesCallCount);
    }

    [Fact]
    public async Task ExecuteAsync_reports_a_missing_room_distinctly()
    {
        var repository = new RoomRepositorySpy();
        var useCase = new JoinRoom(repository, new FixedTimeProvider(CreatedAtUtc.AddMinutes(1)));

        var exception = await Assert.ThrowsAsync<RoomNotFoundException>(
            () => useCase.ExecuteAsync(RoomId, GuestId));

        Assert.Equal(RoomId, exception.RoomId);
        Assert.Equal(0, repository.SaveChangesCallCount);
    }

    [Fact]
    public async Task ExecuteAsync_translates_second_Guest_rejection_to_a_Room_join_rejection()
    {
        var room = CreateRoom();
        room.AddGuest(GuestId, CreatedAtUtc.AddMinutes(1));
        var repository = CreateRepository(room);
        var useCase = new JoinRoom(repository, new FixedTimeProvider(CreatedAtUtc.AddMinutes(2)));

        var exception = await Assert.ThrowsAsync<RoomJoinRejectedException>(
            () => useCase.ExecuteAsync(RoomId, SecondGuestId));

        var cause = Assert.IsType<InvalidOperationException>(exception.InnerException);
        Assert.Equal("The room already has a Guest.", cause.Message);
        Assert.Equal(0, repository.SaveChangesCallCount);
    }

    [Fact]
    public async Task ExecuteAsync_translates_Host_as_Guest_rejection_to_a_Room_join_rejection()
    {
        var room = CreateRoom();
        var repository = CreateRepository(room);
        var useCase = new JoinRoom(repository, new FixedTimeProvider(CreatedAtUtc.AddMinutes(1)));

        var exception = await Assert.ThrowsAsync<RoomJoinRejectedException>(
            () => useCase.ExecuteAsync(RoomId, HostId));

        var cause = Assert.IsType<InvalidOperationException>(exception.InnerException);
        Assert.Equal("The Host cannot join as the Guest.", cause.Message);
        Assert.Equal(0, repository.SaveChangesCallCount);
    }

    [Fact]
    public async Task ExecuteAsync_translates_expired_room_rejection_to_a_Room_join_rejection()
    {
        var room = CreateRoom();
        var repository = CreateRepository(room);
        var useCase = new JoinRoom(repository, new FixedTimeProvider(ExpiresAtUtc));

        var exception = await Assert.ThrowsAsync<RoomJoinRejectedException>(
            () => useCase.ExecuteAsync(RoomId, GuestId));

        var cause = Assert.IsType<InvalidOperationException>(exception.InnerException);
        Assert.Equal("An expired room cannot accept a Guest.", cause.Message);
        Assert.Equal(0, repository.SaveChangesCallCount);
    }

    [Fact]
    public async Task ExecuteAsync_translates_closed_room_rejection_to_a_Room_join_rejection()
    {
        var room = CreateRoom();
        room.Close(CreatedAtUtc.AddMinutes(1));
        var repository = CreateRepository(room);
        var useCase = new JoinRoom(repository, new FixedTimeProvider(CreatedAtUtc.AddMinutes(2)));

        var exception = await Assert.ThrowsAsync<RoomJoinRejectedException>(
            () => useCase.ExecuteAsync(RoomId, GuestId));

        var cause = Assert.IsType<InvalidOperationException>(exception.InnerException);
        Assert.Equal("A closed room cannot accept a Guest.", cause.Message);
        Assert.Equal(0, repository.SaveChangesCallCount);
    }

    [Fact]
    public async Task ExecuteAsync_does_not_translate_a_repository_SaveChanges_failure()
    {
        var room = CreateRoom();
        var repository = CreateRepository(room);
        repository.SaveChangesException = new InvalidOperationException("Persistence operation failed.");
        var useCase = new JoinRoom(repository, new FixedTimeProvider(CreatedAtUtc.AddMinutes(1)));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => useCase.ExecuteAsync(RoomId, GuestId));

        Assert.Equal("Persistence operation failed.", exception.Message);
        Assert.IsNotType<RoomJoinRejectedException>(exception);
        Assert.Equal(1, repository.SaveChangesCallCount);
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
