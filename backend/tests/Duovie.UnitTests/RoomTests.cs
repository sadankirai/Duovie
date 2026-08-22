using Duovie.Domain.Rooms;

namespace Duovie.UnitTests;

public class RoomTests
{
    private static readonly Guid RoomId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid HostId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid GuestId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid SecondGuestId = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly DateTimeOffset CreatedAtUtc = new(2026, 8, 21, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ExpiresAtUtc = CreatedAtUtc.AddHours(2);

    [Fact]
    public void Create_assigns_exactly_one_Host_and_no_Guest()
    {
        var room = CreateRoom();

        Assert.Equal(RoomId, room.Id);
        Assert.Equal(HostId, room.HostId);
        Assert.Null(room.GuestId);
        Assert.Equal(1, room.ParticipantCount);
        Assert.Equal(CreatedAtUtc, room.CreatedAtUtc);
        Assert.Equal(ExpiresAtUtc, room.ExpiresAtUtc);
    }

    [Fact]
    public void Create_places_the_room_in_WaitingForGuest_status()
    {
        var room = CreateRoom();

        Assert.Equal(RoomStatus.WaitingForGuest, room.Status);
    }

    [Fact]
    public void AddGuest_assigns_the_Guest_and_makes_the_room_ready()
    {
        var room = CreateRoom();

        room.AddGuest(GuestId, CreatedAtUtc.AddMinutes(1));

        Assert.Equal(GuestId, room.GuestId);
        Assert.Equal(2, room.ParticipantCount);
        Assert.Equal(RoomStatus.Ready, room.Status);
    }

    [Fact]
    public void AddGuest_rejects_a_second_Guest()
    {
        var room = CreateRoom();
        room.AddGuest(GuestId, CreatedAtUtc.AddMinutes(1));

        var exception = Assert.Throws<InvalidOperationException>(
            () => room.AddGuest(SecondGuestId, CreatedAtUtc.AddMinutes(2)));

        Assert.Equal("The room already has a Guest.", exception.Message);
    }

    [Fact]
    public void AddGuest_rejects_the_Host()
    {
        var room = CreateRoom();

        var exception = Assert.Throws<InvalidOperationException>(
            () => room.AddGuest(HostId, CreatedAtUtc.AddMinutes(1)));

        Assert.Equal("The Host cannot join as the Guest.", exception.Message);
    }

    [Fact]
    public void AddGuest_rejects_an_empty_participant_identifier()
    {
        var room = CreateRoom();

        Assert.Throws<ArgumentException>(
            () => room.AddGuest(Guid.Empty, CreatedAtUtc.AddMinutes(1)));
    }

    [Fact]
    public void Close_records_the_first_close_time_and_marks_the_room_closed()
    {
        var room = CreateRoom();
        var closedAtUtc = CreatedAtUtc.AddMinutes(30);

        room.Close(closedAtUtc);

        Assert.Equal(RoomStatus.Closed, room.Status);
        Assert.Equal(closedAtUtc, room.ClosedAtUtc);
    }

    [Fact]
    public void Close_is_idempotent_and_preserves_the_first_close_time()
    {
        var room = CreateRoom();
        var firstCloseUtc = CreatedAtUtc.AddMinutes(30);

        room.Close(firstCloseUtc);
        room.Close(firstCloseUtc.AddMinutes(1));

        Assert.Equal(firstCloseUtc, room.ClosedAtUtc);
    }

    [Fact]
    public void AddGuest_rejects_a_closed_room()
    {
        var room = CreateRoom();
        room.Close(CreatedAtUtc.AddMinutes(1));

        var exception = Assert.Throws<InvalidOperationException>(
            () => room.AddGuest(GuestId, CreatedAtUtc.AddMinutes(2)));

        Assert.Equal("A closed room cannot accept a Guest.", exception.Message);
    }

    [Fact]
    public void AddGuest_rejects_an_expired_room()
    {
        var room = CreateRoom();

        var exception = Assert.Throws<InvalidOperationException>(
            () => room.AddGuest(GuestId, ExpiresAtUtc));

        Assert.Equal("An expired room cannot accept a Guest.", exception.Message);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Create_rejects_expiration_that_is_not_later_than_creation(int expirationOffsetMinutes)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => Room.Create(
                RoomId,
                HostId,
                CreatedAtUtc,
                CreatedAtUtc.AddMinutes(expirationOffsetMinutes)));
    }

    [Fact]
    public void IsExpired_uses_the_expiration_instant_as_the_boundary()
    {
        var room = CreateRoom();

        Assert.False(room.IsExpired(ExpiresAtUtc.AddTicks(-1)));
        Assert.True(room.IsExpired(ExpiresAtUtc));
        Assert.True(room.IsExpired(ExpiresAtUtc.AddTicks(1)));
        Assert.Equal(RoomStatus.WaitingForGuest, room.Status);
    }

    [Fact]
    public void Create_rejects_an_empty_room_identifier()
    {
        Assert.Throws<ArgumentException>(
            () => Room.Create(Guid.Empty, HostId, CreatedAtUtc, ExpiresAtUtc));
    }

    [Fact]
    public void Create_rejects_an_empty_Host_identifier()
    {
        Assert.Throws<ArgumentException>(
            () => Room.Create(RoomId, Guid.Empty, CreatedAtUtc, ExpiresAtUtc));
    }

    [Fact]
    public void Create_rejects_non_UTC_timestamps()
    {
        var nonUtcCreation = CreatedAtUtc.ToOffset(TimeSpan.FromHours(3));

        Assert.Throws<ArgumentException>(
            () => Room.Create(RoomId, HostId, nonUtcCreation, ExpiresAtUtc));
    }

    [Fact]
    public void Room_operations_reject_times_before_creation()
    {
        var room = CreateRoom();

        Assert.Throws<ArgumentOutOfRangeException>(
            () => room.AddGuest(GuestId, CreatedAtUtc.AddTicks(-1)));
        Assert.Throws<ArgumentOutOfRangeException>(
            () => room.Close(CreatedAtUtc.AddTicks(-1)));
        Assert.Throws<ArgumentOutOfRangeException>(
            () => room.IsExpired(CreatedAtUtc.AddTicks(-1)));
    }

    private static Room CreateRoom()
    {
        return Room.Create(RoomId, HostId, CreatedAtUtc, ExpiresAtUtc);
    }
}
