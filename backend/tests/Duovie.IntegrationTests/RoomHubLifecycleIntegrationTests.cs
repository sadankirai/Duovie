using System.Text.Json;
using Duovie.Api.Realtime;
using Duovie.Application.ParticipantSessions;
using Duovie.Domain.Rooms;
using Duovie.Infrastructure.Persistence.Repositories;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;

namespace Duovie.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class RoomHubLifecycleIntegrationTests(PostgreSqlFixture fixture)
{
    private const string OfferSdp = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=Reconnect offer\r\n";
    private const string AnswerSdp = "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\ns=Reconnect answer\r\n";
    private const string HostCandidate = "candidate:1 1 UDP 1 192.0.2.1 5000 typ host";
    private const string GuestCandidate = "candidate:2 1 UDP 1 192.0.2.2 5001 typ host";
    private static readonly TimeSpan EventTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan NoEventTimeout = TimeSpan.FromMilliseconds(500);

    [Fact]
    public async Task Host_reconnect_restores_identity_presence_chat_and_signaling_without_replay()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var guestConnection = CreateHubConnection(factory, guest);
        await StartAndReceiveSnapshotAsync(guestConnection);
        var hostOnline = CapturePresence(guestConnection, host.ParticipantId, connected: true);
        await using var originalHostConnection = CreateHubConnection(factory, host);
        await StartAndReceiveSnapshotAsync(originalHostConnection);
        await hostOnline.Task.WaitAsync(EventTimeout);

        var originalChat = Capture<RoomChatMessage>(originalHostConnection, RoomChatEvents.Message);
        await guestConnection.InvokeAsync("SendChatMessage", "Old Guest chat.");
        await originalChat.Task.WaitAsync(EventTimeout);
        var originalAnswer = Capture<RoomWebRtcAnswer>(originalHostConnection, RoomWebRtcEvents.Answer);
        await guestConnection.InvokeAsync("SendWebRtcAnswer", AnswerSdp);
        await originalAnswer.Task.WaitAsync(EventTimeout);
        var originalIce = Capture<RoomIceCandidate>(originalHostConnection, RoomWebRtcEvents.IceCandidate);
        await SendIceCandidateAsync(guestConnection, GuestCandidate);
        await originalIce.Task.WaitAsync(EventTimeout);

        var hostOffline = CapturePresence(guestConnection, host.ParticipantId, connected: false);
        await originalHostConnection.StopAsync();
        await hostOffline.Task.WaitAsync(EventTimeout);
        AssertPresenceAbsent(factory, host.RoomId, host.ParticipantId);

        await using var reconnectedHost = CreateHubConnection(factory, host);
        var freshSnapshot = Capture<RoomPresenceSnapshot>(reconnectedHost, RoomPresenceEvents.Snapshot);
        var oldChatReplay = Capture<RoomChatMessage>(reconnectedHost, RoomChatEvents.Message);
        var oldAnswerReplay = Capture<RoomWebRtcAnswer>(reconnectedHost, RoomWebRtcEvents.Answer);
        var oldIceReplay = Capture<RoomIceCandidate>(reconnectedHost, RoomWebRtcEvents.IceCandidate);
        var hostBackOnline = CapturePresence(guestConnection, host.ParticipantId, connected: true);

        await reconnectedHost.StartAsync();

        var snapshot = await freshSnapshot.Task.WaitAsync(EventTimeout);
        AssertPresence(snapshot, host.ParticipantId, "Host", connected: true);
        AssertPresence(snapshot, guest.ParticipantId, "Guest", connected: true);
        await hostBackOnline.Task.WaitAsync(EventTimeout);
        await AssertNoEventAsync(oldChatReplay);
        await AssertNoEventAsync(oldAnswerReplay);
        await AssertNoEventAsync(oldIceReplay);

        var guestChat = Capture<RoomChatMessage>(guestConnection, RoomChatEvents.Message);
        await reconnectedHost.InvokeAsync("SendChatMessage", "Host chat after reconnect.");
        var chat = await guestChat.Task.WaitAsync(EventTimeout);
        Assert.Equal(host.ParticipantId, chat.ParticipantId);
        Assert.Equal("Host", chat.Role);

        var guestOffer = Capture<RoomWebRtcOffer>(guestConnection, RoomWebRtcEvents.Offer);
        await reconnectedHost.InvokeAsync("SendWebRtcOffer", OfferSdp);
        var offer = await guestOffer.Task.WaitAsync(EventTimeout);
        Assert.Equal(host.ParticipantId, offer.ParticipantId);
        Assert.Equal("Host", offer.Role);

        var guestIce = Capture<RoomIceCandidate>(guestConnection, RoomWebRtcEvents.IceCandidate);
        await SendIceCandidateAsync(reconnectedHost, HostCandidate);
        var ice = await guestIce.Task.WaitAsync(EventTimeout);
        Assert.Equal(host.ParticipantId, ice.ParticipantId);
        Assert.Equal("Host", ice.Role);
    }

    [Fact]
    public async Task Guest_reconnect_restores_identity_presence_chat_and_signaling_without_replay()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var hostConnection = CreateHubConnection(factory, host);
        await StartAndReceiveSnapshotAsync(hostConnection);
        var guestOnline = CapturePresence(hostConnection, guest.ParticipantId, connected: true);
        await using var originalGuestConnection = CreateHubConnection(factory, guest);
        await StartAndReceiveSnapshotAsync(originalGuestConnection);
        await guestOnline.Task.WaitAsync(EventTimeout);

        var originalChat = Capture<RoomChatMessage>(originalGuestConnection, RoomChatEvents.Message);
        await hostConnection.InvokeAsync("SendChatMessage", "Old Host chat.");
        await originalChat.Task.WaitAsync(EventTimeout);
        var originalOffer = Capture<RoomWebRtcOffer>(originalGuestConnection, RoomWebRtcEvents.Offer);
        await hostConnection.InvokeAsync("SendWebRtcOffer", OfferSdp);
        await originalOffer.Task.WaitAsync(EventTimeout);
        var originalIce = Capture<RoomIceCandidate>(originalGuestConnection, RoomWebRtcEvents.IceCandidate);
        await SendIceCandidateAsync(hostConnection, HostCandidate);
        await originalIce.Task.WaitAsync(EventTimeout);

        var guestOffline = CapturePresence(hostConnection, guest.ParticipantId, connected: false);
        await originalGuestConnection.StopAsync();
        await guestOffline.Task.WaitAsync(EventTimeout);
        AssertPresenceAbsent(factory, host.RoomId, guest.ParticipantId);

        await using var reconnectedGuest = CreateHubConnection(factory, guest);
        var freshSnapshot = Capture<RoomPresenceSnapshot>(reconnectedGuest, RoomPresenceEvents.Snapshot);
        var oldChatReplay = Capture<RoomChatMessage>(reconnectedGuest, RoomChatEvents.Message);
        var oldOfferReplay = Capture<RoomWebRtcOffer>(reconnectedGuest, RoomWebRtcEvents.Offer);
        var oldIceReplay = Capture<RoomIceCandidate>(reconnectedGuest, RoomWebRtcEvents.IceCandidate);
        var guestBackOnline = CapturePresence(hostConnection, guest.ParticipantId, connected: true);

        await reconnectedGuest.StartAsync();

        var snapshot = await freshSnapshot.Task.WaitAsync(EventTimeout);
        AssertPresence(snapshot, host.ParticipantId, "Host", connected: true);
        AssertPresence(snapshot, guest.ParticipantId, "Guest", connected: true);
        await guestBackOnline.Task.WaitAsync(EventTimeout);
        await AssertNoEventAsync(oldChatReplay);
        await AssertNoEventAsync(oldOfferReplay);
        await AssertNoEventAsync(oldIceReplay);

        var hostChat = Capture<RoomChatMessage>(hostConnection, RoomChatEvents.Message);
        await reconnectedGuest.InvokeAsync("SendChatMessage", "Guest chat after reconnect.");
        var chat = await hostChat.Task.WaitAsync(EventTimeout);
        Assert.Equal(guest.ParticipantId, chat.ParticipantId);
        Assert.Equal("Guest", chat.Role);

        var hostAnswer = Capture<RoomWebRtcAnswer>(hostConnection, RoomWebRtcEvents.Answer);
        await reconnectedGuest.InvokeAsync("SendWebRtcAnswer", AnswerSdp);
        var answer = await hostAnswer.Task.WaitAsync(EventTimeout);
        Assert.Equal(guest.ParticipantId, answer.ParticipantId);
        Assert.Equal("Guest", answer.Role);

        var hostIce = Capture<RoomIceCandidate>(hostConnection, RoomWebRtcEvents.IceCandidate);
        await SendIceCandidateAsync(reconnectedGuest, GuestCandidate);
        var ice = await hostIce.Task.WaitAsync(EventTimeout);
        Assert.Equal(guest.ParticipantId, ice.ParticipantId);
        Assert.Equal("Guest", ice.Role);
    }

    [Fact]
    public async Task Duplicate_connections_prevent_false_offline_and_final_disconnect_allows_fresh_reconnect()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var guestConnection = CreateHubConnection(factory, guest);
        await StartAndReceiveSnapshotAsync(guestConnection);
        var hostOnline = CapturePresence(guestConnection, host.ParticipantId, connected: true);
        await using var firstHost = CreateHubConnection(factory, host);
        await StartAndReceiveSnapshotAsync(firstHost);
        await hostOnline.Task.WaitAsync(EventTimeout);

        var duplicateOnline = CapturePresence(guestConnection, host.ParticipantId, connected: true);
        await using var secondHost = CreateHubConnection(factory, host);
        await StartAndReceiveSnapshotAsync(secondHost);
        await AssertNoEventAsync(duplicateOnline);

        var falseOffline = CapturePresence(guestConnection, host.ParticipantId, connected: false);
        await firstHost.StopAsync();
        await AssertNoEventAsync(falseOffline);
        AssertPresencePresent(factory, host.RoomId, host.ParticipantId, "Host");

        var finalOffline = CapturePresence(guestConnection, host.ParticipantId, connected: false);
        await secondHost.StopAsync();
        await finalOffline.Task.WaitAsync(EventTimeout);
        AssertPresenceAbsent(factory, host.RoomId, host.ParticipantId);

        var onlineAgain = CapturePresence(guestConnection, host.ParticipantId, connected: true);
        await using var reconnectedHost = CreateHubConnection(factory, host);
        await StartAndReceiveSnapshotAsync(reconnectedHost);
        await onlineAgain.Task.WaitAsync(EventTimeout);

        var extraDuplicateOnline = CapturePresence(guestConnection, host.ParticipantId, connected: true);
        await using var extraDuplicate = CreateHubConnection(factory, host);
        await StartAndReceiveSnapshotAsync(extraDuplicate);
        await AssertNoEventAsync(extraDuplicateOnline);

        var noFalseOffline = CapturePresence(guestConnection, host.ParticipantId, connected: false);
        await reconnectedHost.StopAsync();
        await AssertNoEventAsync(noFalseOffline);

        var guestOffer = Capture<RoomWebRtcOffer>(guestConnection, RoomWebRtcEvents.Offer);
        await extraDuplicate.InvokeAsync("SendWebRtcOffer", OfferSdp);
        Assert.Equal(host.ParticipantId, (await guestOffer.Task.WaitAsync(EventTimeout)).ParticipantId);
    }

    [Fact]
    public async Task Reconnect_revalidates_session_Room_lifecycle_and_Room_locator_without_presence_leaks()
    {
        await AssertExpiredSessionReconnectRejectedAsync();
        await AssertWrongRoomReconnectRejectedAsync();
        await AssertClosedRoomReconnectRejectedAsync();
        await AssertExpiredRoomReconnectRejectedAsync();
    }

    private async Task AssertExpiredSessionReconnectRejectedAsync()
    {
        var timeProvider = new AdjustableTimeProvider(PostgreSqlDuovieApiFactory.UtcNow);
        using var factory = new PostgreSqlDuovieApiFactory(
            fixture.ConnectionString,
            timeProvider: timeProvider);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        await using var connection = CreateHubConnection(factory, host);
        await StartAndReceiveSnapshotAsync(connection);

        timeProvider.Advance(TimeSpan.FromMinutes(31));
        await connection.InvokeAsync("SendChatMessage", "Established connection remains valid.");
        await connection.InvokeAsync("SendWebRtcOffer", OfferSdp);
        await SendIceCandidateAsync(connection, HostCandidate);
        await connection.StopAsync();

        await using var reconnect = CreateHubConnection(factory, host);
        await AssertRejectedAsync(reconnect);
        AssertPresenceAbsent(factory, host.RoomId, host.ParticipantId);
    }

    private async Task AssertWrongRoomReconnectRejectedAsync()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var firstHost = await CreateRoomAsync(client);
        var secondHost = await CreateRoomAsync(client);
        await using var originalConnection = CreateHubConnection(factory, firstHost);
        await StartAndReceiveSnapshotAsync(originalConnection);
        await originalConnection.StopAsync();

        await using var wrongRoomReconnect = CreateHubConnection(
            factory,
            firstHost with { RoomId = secondHost.RoomId });
        await AssertRejectedAsync(wrongRoomReconnect);
        AssertPresenceAbsent(factory, secondHost.RoomId, firstHost.ParticipantId);
    }

    private async Task AssertClosedRoomReconnectRejectedAsync()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        await using var originalConnection = CreateHubConnection(factory, host);
        await StartAndReceiveSnapshotAsync(originalConnection);
        await originalConnection.StopAsync();

        await using (var dbContext = fixture.CreateDbContext())
        {
            var repository = new RoomRepository(dbContext);
            var room = await repository.GetByIdAsync(host.RoomId);
            Assert.NotNull(room);
            room.Close(PostgreSqlDuovieApiFactory.UtcNow);
            await repository.SaveChangesAsync();
        }

        await using var reconnect = CreateHubConnection(factory, host);
        await AssertRejectedAsync(reconnect);
        AssertPresenceAbsent(factory, host.RoomId, host.ParticipantId);
    }

    private async Task AssertExpiredRoomReconnectRejectedAsync()
    {
        var timeProvider = new AdjustableTimeProvider(PostgreSqlDuovieApiFactory.UtcNow);
        using var factory = new PostgreSqlDuovieApiFactory(
            fixture.ConnectionString,
            timeProvider: timeProvider);
        var host = await CreateLongSessionShortRoomAsync(timeProvider);
        await using var originalConnection = CreateHubConnection(factory, host);
        await StartAndReceiveSnapshotAsync(originalConnection);
        await originalConnection.StopAsync();

        timeProvider.Advance(TimeSpan.FromHours(2));

        await using var reconnect = CreateHubConnection(factory, host);
        await AssertRejectedAsync(reconnect);
        AssertPresenceAbsent(factory, host.RoomId, host.ParticipantId);
    }

    private async Task<RoomSession> CreateLongSessionShortRoomAsync(TimeProvider timeProvider)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var room = Room.Create(
            Guid.NewGuid(),
            Guid.NewGuid(),
            nowUtc,
            nowUtc.AddHours(1));

        await using var dbContext = fixture.CreateDbContext();
        var roomRepository = new RoomRepository(dbContext);
        await roomRepository.AddAsync(room);
        await roomRepository.SaveChangesAsync();
        var sessionService = new ParticipantSessionService(
            new ParticipantSessionStore(dbContext),
            new ParticipantSessionOptions(TimeSpan.FromHours(4)),
            timeProvider);
        var session = await sessionService.IssueAsync(
            room.Id,
            room.HostId,
            ParticipantRole.Host);

        return new RoomSession(
            room.Id,
            session.ParticipantId,
            "Host",
            session.Credential);
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
        RoomSession session)
    {
        return new HubConnectionBuilder()
            .WithUrl($"https://localhost/hubs/room?roomId={session.RoomId}", options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.AccessTokenProvider = () => Task.FromResult<string?>(session.Credential);
                options.Transports = HttpTransportType.LongPolling;
            })
            .Build();
    }

    private static async Task<RoomPresenceSnapshot> StartAndReceiveSnapshotAsync(
        HubConnection connection)
    {
        var snapshot = Capture<RoomPresenceSnapshot>(connection, RoomPresenceEvents.Snapshot);
        await connection.StartAsync();
        return await snapshot.Task.WaitAsync(EventTimeout);
    }

    private static TaskCompletionSource<T> Capture<T>(HubConnection connection, string eventName)
    {
        var received = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<T>(eventName, value => received.TrySetResult(value));
        return received;
    }

    private static TaskCompletionSource<RoomPresenceParticipant> CapturePresence(
        HubConnection connection,
        Guid participantId,
        bool connected)
    {
        var received = new TaskCompletionSource<RoomPresenceParticipant>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<RoomPresenceParticipant>(
            RoomPresenceEvents.Changed,
            presence =>
            {
                if (presence.ParticipantId == participantId && presence.Connected == connected)
                {
                    received.TrySetResult(presence);
                }
            });
        return received;
    }

    private static Task SendIceCandidateAsync(HubConnection connection, string candidate)
    {
        return connection.InvokeAsync("SendIceCandidate", candidate, null, null, null);
    }

    private static async Task AssertNoEventAsync<T>(TaskCompletionSource<T> eventReceived)
    {
        var completed = await Task.WhenAny(eventReceived.Task, Task.Delay(NoEventTimeout));
        Assert.NotSame(eventReceived.Task, completed);
        Assert.False(eventReceived.Task.IsCompletedSuccessfully);
    }

    private static async Task AssertRejectedAsync(HubConnection connection)
    {
        var snapshotReceived = Capture<RoomPresenceSnapshot>(
            connection,
            RoomPresenceEvents.Snapshot);
        var disconnected = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously);
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

    private static void AssertPresencePresent(
        PostgreSqlDuovieApiFactory factory,
        Guid roomId,
        Guid participantId,
        string role)
    {
        var registry = factory.Services.GetRequiredService<IRoomPresenceRegistry>();
        AssertPresence(
            new RoomPresenceSnapshot(registry.GetSnapshot(roomId)),
            participantId,
            role,
            connected: true);
    }

    private static void AssertPresenceAbsent(
        PostgreSqlDuovieApiFactory factory,
        Guid roomId,
        Guid participantId)
    {
        var registry = factory.Services.GetRequiredService<IRoomPresenceRegistry>();
        Assert.DoesNotContain(
            registry.GetSnapshot(roomId),
            participant => participant.ParticipantId == participantId);
    }

    private static async Task<RoomSession> CreateRoomAsync(HttpClient client)
    {
        using var response = await client.PostAsync("/api/rooms", null);
        Assert.Equal(System.Net.HttpStatusCode.Created, response.StatusCode);
        return await ReadRoomSessionAsync(response, "Host");
    }

    private static async Task<RoomSession> JoinRoomAsync(HttpClient client, Guid roomId)
    {
        using var response = await client.PostAsync($"/api/rooms/{roomId}/join", null);
        Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
        return await ReadRoomSessionAsync(response, "Guest");
    }

    private static async Task<RoomSession> ReadRoomSessionAsync(
        HttpResponseMessage response,
        string role)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var room = document.RootElement.GetProperty("room");
        var participant = document.RootElement.GetProperty("participant");

        return new RoomSession(
            room.GetProperty("id").GetGuid(),
            participant.GetProperty("id").GetGuid(),
            role,
            participant.GetProperty("credential").GetString()!);
    }

    private sealed record RoomSession(
        Guid RoomId,
        Guid ParticipantId,
        string Role,
        string Credential);

    private sealed class AdjustableTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        private DateTimeOffset _utcNow = utcNow;

        public override DateTimeOffset GetUtcNow()
        {
            return _utcNow;
        }

        public void Advance(TimeSpan amount)
        {
            _utcNow = _utcNow.Add(amount);
        }
    }
}
