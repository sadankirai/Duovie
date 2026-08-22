using Duovie.Application.ParticipantSessions;
using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;

namespace Duovie.UnitTests;

public class RoomSessionFlowTests
{
    private static readonly Guid RoomId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid HostId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid ExistingGuestId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly DateTimeOffset NowUtc = new(2026, 8, 22, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset RoomExpiresAtUtc = NowUtc.AddHours(2);

    [Fact]
    public async Task Create_flow_generates_and_binds_the_Host_identity_inside_one_transaction()
    {
        var roomRepository = new RoomRepositorySpy();
        var sessionStore = new ParticipantSessionStoreSpy();
        var transaction = new ImmediateRoomSessionTransaction();
        var flow = new CreateRoomSession(
            new CreateRoom(roomRepository, new FixedTimeProvider(NowUtc)),
            CreateSessionService(sessionStore),
            transaction);

        var result = await flow.ExecuteAsync(RoomExpiresAtUtc);

        Assert.NotEqual(Guid.Empty, result.Room.HostId);
        Assert.NotEqual(result.Room.Id, result.Room.HostId);
        Assert.Equal(result.Room.Id, result.Session.RoomId);
        Assert.Equal(result.Room.HostId, result.Session.ParticipantId);
        Assert.Equal(ParticipantRole.Host, result.Session.Role);
        Assert.Equal(1, transaction.ExecuteCallCount);
        Assert.Single(sessionStore.AddedSessions);
    }

    [Fact]
    public async Task Join_flow_issues_a_Guest_session_only_after_the_join_succeeds()
    {
        var room = CreateWaitingRoom();
        var roomRepository = new RoomRepositorySpy();
        roomRepository.Seed(room);
        var sessionStore = new ParticipantSessionStoreSpy();
        var flow = new JoinRoomSession(
            new JoinRoom(roomRepository, new FixedTimeProvider(NowUtc.AddMinutes(1))),
            CreateSessionService(sessionStore),
            new ImmediateRoomSessionTransaction());

        var result = await flow.ExecuteAsync(RoomId);

        Assert.Equal(result.Session.ParticipantId, room.GuestId);
        Assert.NotEqual(room.HostId, result.Session.ParticipantId);
        Assert.Equal(ParticipantRole.Guest, result.Session.Role);
        Assert.Single(sessionStore.AddedSessions);
    }

    [Theory]
    [InlineData(JoinFailure.Missing)]
    [InlineData(JoinFailure.Full)]
    [InlineData(JoinFailure.Closed)]
    [InlineData(JoinFailure.Expired)]
    public async Task Join_flow_does_not_issue_a_session_when_the_join_fails(JoinFailure failure)
    {
        var roomRepository = new RoomRepositorySpy();
        var currentTimeUtc = NowUtc.AddMinutes(2);

        if (failure != JoinFailure.Missing)
        {
            var room = CreateWaitingRoom();

            if (failure == JoinFailure.Full)
            {
                room.AddGuest(ExistingGuestId, NowUtc.AddMinutes(1));
            }
            else if (failure == JoinFailure.Closed)
            {
                room.Close(NowUtc.AddMinutes(1));
            }
            else if (failure == JoinFailure.Expired)
            {
                currentTimeUtc = RoomExpiresAtUtc;
            }

            roomRepository.Seed(room);
        }

        var sessionStore = new ParticipantSessionStoreSpy();
        var flow = new JoinRoomSession(
            new JoinRoom(roomRepository, new FixedTimeProvider(currentTimeUtc)),
            CreateSessionService(sessionStore),
            new ImmediateRoomSessionTransaction());

        await Assert.ThrowsAnyAsync<Exception>(() => flow.ExecuteAsync(RoomId));

        Assert.Empty(sessionStore.AddedSessions);
        Assert.Equal(0, sessionStore.SaveChangesCallCount);
    }

    private static ParticipantSessionService CreateSessionService(ParticipantSessionStoreSpy store)
    {
        return new ParticipantSessionService(
            store,
            new ParticipantSessionOptions(TimeSpan.FromMinutes(30)),
            new FixedTimeProvider(NowUtc));
    }

    private static Room CreateWaitingRoom()
    {
        return Room.Create(RoomId, HostId, NowUtc, RoomExpiresAtUtc);
    }

    public enum JoinFailure
    {
        Missing,
        Full,
        Closed,
        Expired,
    }
}
