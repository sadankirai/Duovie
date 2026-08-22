using Duovie.Application.ParticipantSessions;
using Duovie.Domain.Rooms;

namespace Duovie.UnitTests;

public class ParticipantSessionAuthorizerTests
{
    private static readonly Guid RoomId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid HostId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid GuestId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly DateTimeOffset NowUtc = new(2026, 8, 22, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task RequireHostAsync_accepts_the_Rooms_bound_Host_session()
    {
        var (authorizer, service) = CreateAuthorizer();
        var issued = await service.IssueAsync(RoomId, HostId, ParticipantRole.Host);

        var validated = await authorizer.RequireHostAsync(issued.Credential, RoomId);

        Assert.Equal(RoomId, validated.RoomId);
        Assert.Equal(HostId, validated.ParticipantId);
        Assert.Equal(ParticipantRole.Host, validated.Role);
    }

    [Fact]
    public async Task RequireHostAsync_rejects_a_Guest_session()
    {
        var (authorizer, service) = CreateAuthorizer();
        var issued = await service.IssueAsync(RoomId, GuestId, ParticipantRole.Guest);

        await Assert.ThrowsAsync<ParticipantSessionAuthorizationException>(
            () => authorizer.RequireHostAsync(issued.Credential, RoomId));
    }

    [Fact]
    public async Task RequireHostAsync_rejects_a_Host_role_not_bound_to_Room_HostId()
    {
        var (authorizer, service) = CreateAuthorizer();
        var issued = await service.IssueAsync(RoomId, GuestId, ParticipantRole.Host);

        await Assert.ThrowsAsync<ParticipantSessionAuthorizationException>(
            () => authorizer.RequireHostAsync(issued.Credential, RoomId));
    }

    private static (ParticipantSessionAuthorizer Authorizer, ParticipantSessionService Service) CreateAuthorizer()
    {
        var roomRepository = new RoomRepositorySpy();
        roomRepository.Seed(Room.Create(RoomId, HostId, NowUtc, NowUtc.AddHours(2)));
        var service = new ParticipantSessionService(
            new ParticipantSessionStoreSpy(),
            new ParticipantSessionOptions(TimeSpan.FromMinutes(30)),
            new FixedTimeProvider(NowUtc));

        return (new ParticipantSessionAuthorizer(service, roomRepository), service);
    }
}
