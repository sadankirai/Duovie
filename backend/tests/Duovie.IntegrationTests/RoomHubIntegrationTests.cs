using System.Net.Http.Json;
using System.Text.Json;
using Duovie.Api.Realtime;
using Duovie.Application.ParticipantSessions;
using Duovie.Domain.Rooms;
using Duovie.Infrastructure.Persistence.Repositories;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Duovie.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class RoomHubIntegrationTests(PostgreSqlFixture fixture)
{
    private static readonly TimeSpan EventTimeout = TimeSpan.FromSeconds(5);

    [Fact]
    public async Task Host_and_Guest_connect_with_server_derived_identity_and_observe_each_others_presence()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var hostConnection = CreateHubConnection(
            factory,
            host.RoomId,
            host.Credential,
            $"&participantId={Guid.NewGuid()}&role=Guest");
        var guestOnline = new TaskCompletionSource<RoomPresenceParticipant>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        hostConnection.On<RoomPresenceParticipant>(
            RoomPresenceEvents.Changed,
            presence =>
            {
                if (presence.ParticipantId == guest.ParticipantId && presence.Connected)
                {
                    guestOnline.TrySetResult(presence);
                }
            });

        var hostSnapshot = await StartAndReceiveSnapshotAsync(hostConnection);

        Assert.Single(hostSnapshot.Participants);
        AssertPresence(hostSnapshot, host.ParticipantId, "Host", connected: true);

        await using var guestConnection = CreateHubConnection(factory, host.RoomId, guest.Credential);
        var guestSnapshot = await StartAndReceiveSnapshotAsync(guestConnection);
        var guestPresence = await guestOnline.Task.WaitAsync(EventTimeout);

        AssertPresence(guestSnapshot, host.ParticipantId, "Host", connected: true);
        AssertPresence(guestSnapshot, guest.ParticipantId, "Guest", connected: true);
        Assert.Equal(guest.ParticipantId, guestPresence.ParticipantId);
        Assert.Equal("Guest", guestPresence.Role);
        Assert.True(guestPresence.Connected);
        AssertCredentialAbsent(host.Credential, JsonSerializer.Serialize(hostSnapshot));
        AssertCredentialAbsent(guest.Credential, JsonSerializer.Serialize(guestSnapshot));
    }

    [Fact]
    public async Task Browser_query_token_WebSocket_is_Room_bound_and_does_not_leak_credential_to_logs_or_presence()
    {
        using var logs = new CapturingLoggerProvider();
        using var factory = new PostgreSqlDuovieApiFactory(
            fixture.ConnectionString,
            loggerProvider: logs);
        using var client = CreateHttpClient(factory);
        var firstRoom = await CreateRoomAsync(client);
        var secondRoom = await CreateRoomAsync(client);
        await using var connection = CreateQueryTokenWebSocketConnection(
            factory,
            firstRoom.RoomId,
            firstRoom.Credential);

        var snapshot = await StartAndReceiveSnapshotAsync(connection);

        AssertPresence(snapshot, firstRoom.ParticipantId, "Host", connected: true);
        AssertCredentialAbsent(firstRoom.Credential, JsonSerializer.Serialize(snapshot));
        await connection.StopAsync();

        await using var wrongRoomConnection = CreateQueryTokenWebSocketConnection(
            factory,
            secondRoom.RoomId,
            firstRoom.Credential);
        await AssertRejectedAsync(wrongRoomConnection);

        const string warningProbe = "Hosting warning diagnostics remain enabled.";
        factory.Services
            .GetRequiredService<ILoggerFactory>()
            .CreateLogger("Microsoft.AspNetCore.Hosting.Diagnostics")
            .LogWarning(warningProbe);

        Assert.Contains(logs.Messages, message => message.Contains(warningProbe, StringComparison.Ordinal));
        Assert.False(
            logs.Messages.Any(message => message.Contains(firstRoom.Credential, StringComparison.Ordinal)),
            "Captured application logs contained the participant credential.");
    }

    [Fact]
    public async Task Guest_disconnect_notifies_the_Host_that_the_Guest_is_offline()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var hostConnection = CreateHubConnection(factory, host.RoomId, host.Credential);
        var guestOffline = new TaskCompletionSource<RoomPresenceParticipant>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        hostConnection.On<RoomPresenceParticipant>(
            RoomPresenceEvents.Changed,
            presence =>
            {
                if (presence.ParticipantId == guest.ParticipantId && !presence.Connected)
                {
                    guestOffline.TrySetResult(presence);
                }
            });

        await StartAndReceiveSnapshotAsync(hostConnection);
        await using var guestConnection = CreateHubConnection(factory, host.RoomId, guest.Credential);
        await StartAndReceiveSnapshotAsync(guestConnection);

        await guestConnection.StopAsync();
        var disconnected = await guestOffline.Task.WaitAsync(EventTimeout);

        Assert.Equal(guest.ParticipantId, disconnected.ParticipantId);
        Assert.Equal("Guest", disconnected.Role);
        Assert.False(disconnected.Connected);
    }

    [Fact]
    public async Task Duplicate_connections_keep_a_participant_logically_online_until_the_final_disconnect()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        await using var firstConnection = CreateHubConnection(factory, host.RoomId, host.Credential);
        await using var secondConnection = CreateHubConnection(factory, host.RoomId, host.Credential);

        await StartAndReceiveSnapshotAsync(firstConnection);
        await StartAndReceiveSnapshotAsync(secondConnection);
        await firstConnection.StopAsync();

        using var scope = factory.Services.CreateScope();
        var registry = scope.ServiceProvider.GetRequiredService<IRoomPresenceRegistry>();
        var snapshot = registry.GetSnapshot(host.RoomId);

        Assert.Single(snapshot);
        AssertPresence(new RoomPresenceSnapshot(snapshot), host.ParticipantId, "Host", connected: true);

        await secondConnection.StopAsync();
        await WaitForSnapshotToBeEmptyAsync(registry, host.RoomId);
    }

    [Fact]
    public async Task Missing_malformed_and_unknown_credentials_cannot_connect_using_only_a_Room_identifier()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);

        foreach (var credential in new string?[]
                 {
                     null,
                     "not-a-credential",
                     new string('A', 43),
                 })
        {
            await using var connection = CreateHubConnection(factory, host.RoomId, credential);

            await AssertRejectedAsync(connection);
        }
    }

    [Fact]
    public async Task Expired_session_and_closed_or_expired_Rooms_cannot_connect()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        var expiredSession = await CreatePersistedParticipantAsync(
            participantIssuedAtUtc: PostgreSqlDuovieApiFactory.UtcNow.AddMinutes(-31),
            roomState: RoomConnectionState.Active);
        var closedRoom = await CreatePersistedParticipantAsync(
            participantIssuedAtUtc: PostgreSqlDuovieApiFactory.UtcNow,
            roomState: RoomConnectionState.Closed);
        var expiredRoom = await CreatePersistedParticipantAsync(
            participantIssuedAtUtc: PostgreSqlDuovieApiFactory.UtcNow,
            roomState: RoomConnectionState.Expired);

        foreach (var participant in new[] { expiredSession, closedRoom, expiredRoom })
        {
            await using var connection = CreateHubConnection(
                factory,
                participant.RoomId,
                participant.Credential);

            await AssertRejectedAsync(connection);
        }
    }

    [Fact]
    public async Task Credential_for_one_Room_and_missing_or_malformed_Room_metadata_are_rejected()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var firstRoom = await CreateRoomAsync(client);
        var secondRoom = await CreateRoomAsync(client);

        await using var wrongRoom = CreateHubConnection(factory, secondRoom.RoomId, firstRoom.Credential);
        await AssertRejectedAsync(wrongRoom);

        await using var missingRoom = CreateHubConnection(factory, roomId: null, firstRoom.Credential);
        await AssertRejectedAsync(missingRoom);

        await using var malformedRoom = CreateHubConnection(
            factory,
            roomId: null,
            firstRoom.Credential,
            "?roomId=not-a-guid");
        await AssertRejectedAsync(malformedRoom);
    }

    private async Task<PersistedParticipant> CreatePersistedParticipantAsync(
        DateTimeOffset participantIssuedAtUtc,
        RoomConnectionState roomState)
    {
        var nowUtc = PostgreSqlDuovieApiFactory.UtcNow;
        var room = roomState switch
        {
            RoomConnectionState.Active => Room.Create(
                Guid.NewGuid(),
                Guid.NewGuid(),
                nowUtc.AddHours(-1),
                nowUtc.AddHours(1)),
            RoomConnectionState.Closed => Room.Create(
                Guid.NewGuid(),
                Guid.NewGuid(),
                nowUtc.AddHours(-1),
                nowUtc.AddHours(1)),
            RoomConnectionState.Expired => Room.Create(
                Guid.NewGuid(),
                Guid.NewGuid(),
                nowUtc.AddHours(-2),
                nowUtc.AddMinutes(-1)),
            _ => throw new ArgumentOutOfRangeException(nameof(roomState)),
        };

        if (roomState == RoomConnectionState.Closed)
        {
            room.Close(nowUtc.AddMinutes(-30));
        }

        await using var dbContext = fixture.CreateDbContext();
        var roomRepository = new RoomRepository(dbContext);
        await roomRepository.AddAsync(room);
        await roomRepository.SaveChangesAsync();
        var sessionService = new ParticipantSessionService(
            new ParticipantSessionStore(dbContext),
            new ParticipantSessionOptions(TimeSpan.FromMinutes(30)),
            new FixedTimeProvider(participantIssuedAtUtc));
        var issued = await sessionService.IssueAsync(room.Id, room.HostId, ParticipantRole.Host);

        return new PersistedParticipant(room.Id, issued.Credential);
    }

    private static HttpClient CreateHttpClient(WebApplicationFactory<Program> factory)
    {
        return factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
        });
    }

    private static HubConnection CreateHubConnection(
        PostgreSqlDuovieApiFactory factory,
        Guid? roomId,
        string? credential,
        string? additionalQuery = null)
    {
        var query = roomId is null
            ? additionalQuery ?? string.Empty
            : $"?roomId={roomId.Value}{additionalQuery}";

        return new HubConnectionBuilder()
            .WithUrl($"https://localhost/hubs/room{query}", options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.AccessTokenProvider = () => Task.FromResult(credential);
                options.Transports = HttpTransportType.LongPolling;
            })
            .Build();
    }

    private static HubConnection CreateQueryTokenWebSocketConnection(
        PostgreSqlDuovieApiFactory factory,
        Guid roomId,
        string credential)
    {
        var queryCredential = Uri.EscapeDataString(credential);

        return new HubConnectionBuilder()
            .WithUrl(
                $"https://localhost/hubs/room?roomId={roomId}&access_token={queryCredential}",
                options =>
                {
                    options.SkipNegotiation = true;
                    options.Transports = HttpTransportType.WebSockets;
                    options.WebSocketFactory = async (context, cancellationToken) =>
                    {
                        var webSocketClient = factory.Server.CreateWebSocketClient();
                        return await webSocketClient.ConnectAsync(context.Uri, cancellationToken);
                    };
                })
            .Build();
    }

    private static async Task<RoomPresenceSnapshot> StartAndReceiveSnapshotAsync(HubConnection connection)
    {
        var snapshotReceived = new TaskCompletionSource<RoomPresenceSnapshot>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<RoomPresenceSnapshot>(
            RoomPresenceEvents.Snapshot,
            snapshot => snapshotReceived.TrySetResult(snapshot));

        await connection.StartAsync();

        return await snapshotReceived.Task.WaitAsync(EventTimeout);
    }

    private static async Task AssertRejectedAsync(HubConnection connection)
    {
        var snapshotReceived = new TaskCompletionSource<RoomPresenceSnapshot>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var disconnected = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<RoomPresenceSnapshot>(
            RoomPresenceEvents.Snapshot,
            snapshot => snapshotReceived.TrySetResult(snapshot));
        connection.Closed += _ =>
        {
            disconnected.TrySetResult();
            return Task.CompletedTask;
        };

        await connection.StartAsync();

        var completed = await Task.WhenAny(
            disconnected.Task,
            snapshotReceived.Task,
            Task.Delay(EventTimeout));

        Assert.Same(disconnected.Task, completed);
        Assert.False(snapshotReceived.Task.IsCompletedSuccessfully);
    }

    private static async Task WaitForSnapshotToBeEmptyAsync(
        IRoomPresenceRegistry registry,
        Guid roomId)
    {
        var deadline = DateTime.UtcNow.Add(EventTimeout);

        while (DateTime.UtcNow < deadline)
        {
            if (registry.GetSnapshot(roomId).Count == 0)
            {
                return;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(25));
        }

        Assert.Empty(registry.GetSnapshot(roomId));
    }

    private static async Task<RoomSession> CreateRoomAsync(HttpClient client)
    {
        using var response = await client.PostAsync("/api/rooms", null);
        Assert.Equal(System.Net.HttpStatusCode.Created, response.StatusCode);

        return await ReadRoomSessionAsync(response);
    }

    private static async Task<RoomSession> JoinRoomAsync(HttpClient client, Guid roomId)
    {
        using var response = await client.PostAsync($"/api/rooms/{roomId}/join", null);
        Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);

        return await ReadRoomSessionAsync(response);
    }

    private static async Task<RoomSession> ReadRoomSessionAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var room = document.RootElement.GetProperty("room");
        var participant = document.RootElement.GetProperty("participant");

        return new RoomSession(
            room.GetProperty("id").GetGuid(),
            participant.GetProperty("id").GetGuid(),
            participant.GetProperty("credential").GetString()!);
    }

    private static void AssertPresence(
        RoomPresenceSnapshot snapshot,
        Guid participantId,
        string role,
        bool connected)
    {
        Assert.Contains(snapshot.Participants, participant =>
            participant.ParticipantId == participantId
            && participant.Role == role
            && participant.Connected == connected);
    }

    private static void AssertCredentialAbsent(string credential, string content)
    {
        Assert.False(
            content.Contains(credential, StringComparison.Ordinal),
            "A safe presence payload contained the participant credential.");
    }

    private sealed record RoomSession(Guid RoomId, Guid ParticipantId, string Credential);

    private sealed record PersistedParticipant(Guid RoomId, string Credential);

    private enum RoomConnectionState
    {
        Active,
        Closed,
        Expired,
    }

    private sealed class FixedTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow()
        {
            return utcNow;
        }
    }
}
