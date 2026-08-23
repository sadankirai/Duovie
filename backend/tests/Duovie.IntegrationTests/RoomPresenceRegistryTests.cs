using Duovie.Api.Realtime;
using Duovie.Application.ParticipantSessions;

namespace Duovie.IntegrationTests;

public sealed class RoomPresenceRegistryTests
{
    private static readonly Guid RoomId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly RoomHubConnectionIdentity Host = new(
        RoomId,
        Guid.Parse("22222222-2222-2222-2222-222222222222"),
        ParticipantRole.Host);
    private static readonly RoomHubConnectionIdentity Guest = new(
        RoomId,
        Guid.Parse("33333333-3333-3333-3333-333333333333"),
        ParticipantRole.Guest);

    [Fact]
    public void Registry_reports_logical_presence_transitions_for_duplicate_connections()
    {
        var registry = new RoomPresenceRegistry();

        Assert.True(registry.Add(Host, "host-1"));
        Assert.False(registry.Add(Host, "host-2"));
        Assert.True(registry.Add(Guest, "guest-1"));

        var snapshot = registry.GetSnapshot(RoomId);
        Assert.Equal(2, snapshot.Count);
        Assert.Contains(snapshot, participant =>
            participant.ParticipantId == Host.ParticipantId
            && participant.Role == "Host"
            && participant.Connected);
        Assert.Contains(snapshot, participant =>
            participant.ParticipantId == Guest.ParticipantId
            && participant.Role == "Guest"
            && participant.Connected);

        Assert.False(registry.Remove(Host, "host-1"));
        Assert.True(registry.Remove(Host, "host-2"));
        Assert.False(registry.Remove(Host, "host-2"));
        Assert.True(registry.Remove(Guest, "guest-1"));
        Assert.Empty(registry.GetSnapshot(RoomId));
    }

    [Fact]
    public async Task Registry_is_thread_safe_for_concurrent_connections()
    {
        var registry = new RoomPresenceRegistry();
        var connections = Enumerable.Range(0, 32)
            .Select(index => (
                Participant: index % 2 == 0 ? Host : Guest,
                ConnectionId: $"connection-{index}"))
            .ToArray();

        var adds = await Task.WhenAll(connections.Select(connection => Task.Run(
            () => registry.Add(connection.Participant, connection.ConnectionId))));

        Assert.Equal(2, adds.Count(transitioned => transitioned));
        Assert.Equal(2, registry.GetSnapshot(RoomId).Count);

        var removals = await Task.WhenAll(connections.Select(connection => Task.Run(
            () => registry.Remove(connection.Participant, connection.ConnectionId))));

        Assert.Equal(2, removals.Count(transitioned => transitioned));
        Assert.Empty(registry.GetSnapshot(RoomId));
    }
}
