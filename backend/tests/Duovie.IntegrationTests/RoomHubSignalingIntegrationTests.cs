using System.Text.Json;
using Duovie.Api.Hubs;
using Duovie.Api.Realtime;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

namespace Duovie.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class RoomHubSignalingIntegrationTests(PostgreSqlFixture fixture)
{
    private const string OfferSdp = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=Duovie offer\r\nt=0 0\r\n";
    private const string AnswerSdp = "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\ns=Duovie answer\r\nt=0 0\r\n";
    private const string HostCandidate = "candidate:1 1 UDP 1 192.0.2.1 5000 typ host";
    private const string GuestCandidate = "candidate:2 1 UDP 1 192.0.2.2 5001 typ host";
    private static readonly TimeSpan EventTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan NoEventTimeout = TimeSpan.FromMilliseconds(500);

    [Fact]
    public async Task Offer_and_Answer_reach_every_opposite_role_connection_without_same_role_reflection()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var firstHost = CreateHubConnection(factory, host);
        await using var secondHost = CreateHubConnection(factory, host);
        await using var firstGuest = CreateHubConnection(factory, guest);
        await using var secondGuest = CreateHubConnection(factory, guest);
        var firstGuestOffer = Capture<RoomWebRtcOffer>(firstGuest, RoomWebRtcEvents.Offer);
        var secondGuestOffer = Capture<RoomWebRtcOffer>(secondGuest, RoomWebRtcEvents.Offer);
        var secondHostOffer = Capture<RoomWebRtcOffer>(secondHost, RoomWebRtcEvents.Offer);
        var firstHostAnswer = Capture<RoomWebRtcAnswer>(firstHost, RoomWebRtcEvents.Answer);
        var secondHostAnswer = Capture<RoomWebRtcAnswer>(secondHost, RoomWebRtcEvents.Answer);
        var secondGuestAnswer = Capture<RoomWebRtcAnswer>(secondGuest, RoomWebRtcEvents.Answer);

        await StartAndReceiveSnapshotAsync(firstHost);
        await StartAndReceiveSnapshotAsync(secondHost);
        await StartAndReceiveSnapshotAsync(firstGuest);
        await StartAndReceiveSnapshotAsync(secondGuest);

        await firstHost.InvokeAsync("SendWebRtcOffer", OfferSdp);

        var offer = await firstGuestOffer.Task.WaitAsync(EventTimeout);
        Assert.Equal(offer, await secondGuestOffer.Task.WaitAsync(EventTimeout));
        AssertOffer(offer, host, OfferSdp, guest.Credential);
        await AssertNoSignalAsync(secondHostOffer);

        await firstGuest.InvokeAsync("SendWebRtcAnswer", AnswerSdp);

        var answer = await firstHostAnswer.Task.WaitAsync(EventTimeout);
        Assert.Equal(answer, await secondHostAnswer.Task.WaitAsync(EventTimeout));
        AssertAnswer(answer, guest, AnswerSdp, host.Credential);
        await AssertNoSignalAsync(secondGuestAnswer);
    }

    [Fact]
    public async Task ICE_is_bidirectional_and_reaches_only_opposite_role_connections()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var firstHost = CreateHubConnection(factory, host);
        await using var secondHost = CreateHubConnection(factory, host);
        await using var firstGuest = CreateHubConnection(factory, guest);
        await using var secondGuest = CreateHubConnection(factory, guest);
        var firstGuestCandidate = Capture<RoomIceCandidate>(firstGuest, RoomWebRtcEvents.IceCandidate);
        var secondGuestCandidate = Capture<RoomIceCandidate>(secondGuest, RoomWebRtcEvents.IceCandidate);
        var secondHostReflection = Capture<RoomIceCandidate>(secondHost, RoomWebRtcEvents.IceCandidate);
        var firstHostCandidate = Capture<RoomIceCandidate>(firstHost, RoomWebRtcEvents.IceCandidate);
        var secondHostCandidate = Capture<RoomIceCandidate>(secondHost, RoomWebRtcEvents.IceCandidate);

        await StartAndReceiveSnapshotAsync(firstHost);
        await StartAndReceiveSnapshotAsync(secondHost);
        await StartAndReceiveSnapshotAsync(firstGuest);
        await StartAndReceiveSnapshotAsync(secondGuest);

        var hostCandidateWithBoundaryWhitespace = $"  {HostCandidate}  ";
        await SendIceCandidateAsync(firstHost, hostCandidateWithBoundaryWhitespace, "video", 1, "host-ufrag");

        var hostCandidate = await firstGuestCandidate.Task.WaitAsync(EventTimeout);
        Assert.Equal(hostCandidate, await secondGuestCandidate.Task.WaitAsync(EventTimeout));
        AssertIceCandidate(
            hostCandidate,
            host,
            hostCandidateWithBoundaryWhitespace,
            "video",
            1,
            "host-ufrag",
            guest.Credential);
        await AssertNoSignalAsync(secondHostReflection);

        var secondGuestReflection = Capture<RoomIceCandidate>(secondGuest, RoomWebRtcEvents.IceCandidate);
        await SendIceCandidateAsync(firstGuest, GuestCandidate, null, null, null);

        var guestCandidate = await firstHostCandidate.Task.WaitAsync(EventTimeout);
        Assert.Equal(guestCandidate, await secondHostCandidate.Task.WaitAsync(EventTimeout));
        AssertIceCandidate(
            guestCandidate,
            guest,
            GuestCandidate,
            null,
            null,
            null,
            host.Credential);
        await AssertNoSignalAsync(secondGuestReflection);
    }

    [Fact]
    public async Task Screen_share_active_and_inactive_reach_every_Guest_connection_without_Host_reflection()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var firstHost = CreateHubConnection(factory, host);
        await using var secondHost = CreateHubConnection(factory, host);
        await using var firstGuest = CreateHubConnection(factory, guest);
        await using var secondGuest = CreateHubConnection(factory, guest);
        var firstGuestActive = Capture<RoomScreenShareStateChanged>(
            firstGuest,
            RoomScreenShareEvents.StateChanged);
        var secondGuestActive = Capture<RoomScreenShareStateChanged>(
            secondGuest,
            RoomScreenShareEvents.StateChanged);
        var secondHostReflection = Capture<RoomScreenShareStateChanged>(
            secondHost,
            RoomScreenShareEvents.StateChanged);

        await StartAndReceiveSnapshotAsync(firstHost);
        await StartAndReceiveSnapshotAsync(secondHost);
        await StartAndReceiveSnapshotAsync(firstGuest);
        await StartAndReceiveSnapshotAsync(secondGuest);

        await firstHost.InvokeAsync(nameof(RoomHub.SendScreenShareState), true);

        var activeState = await firstGuestActive.Task.WaitAsync(EventTimeout);
        Assert.Equal(activeState, await secondGuestActive.Task.WaitAsync(EventTimeout));
        AssertScreenShareState(activeState, host, active: true, guest.Credential);
        await AssertNoSignalAsync(secondHostReflection);

        var firstGuestInactive = Capture<RoomScreenShareStateChanged>(
            firstGuest,
            RoomScreenShareEvents.StateChanged);
        var secondGuestInactive = Capture<RoomScreenShareStateChanged>(
            secondGuest,
            RoomScreenShareEvents.StateChanged);

        await firstHost.InvokeAsync(nameof(RoomHub.SendScreenShareState), false);

        var inactiveState = await firstGuestInactive.Task.WaitAsync(EventTimeout);
        Assert.Equal(inactiveState, await secondGuestInactive.Task.WaitAsync(EventTimeout));
        AssertScreenShareState(inactiveState, host, active: false, guest.Credential);
    }

    [Fact]
    public async Task Screen_share_state_is_Room_scoped()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var firstHostSession = await CreateRoomAsync(client);
        var firstGuestSession = await JoinRoomAsync(client, firstHostSession.RoomId);
        var secondHostSession = await CreateRoomAsync(client);
        var secondGuestSession = await JoinRoomAsync(client, secondHostSession.RoomId);
        await using var firstHost = CreateHubConnection(factory, firstHostSession);
        await using var firstGuest = CreateHubConnection(factory, firstGuestSession);
        await using var secondHost = CreateHubConnection(factory, secondHostSession);
        await using var secondGuest = CreateHubConnection(factory, secondGuestSession);
        var firstRoomState = Capture<RoomScreenShareStateChanged>(
            firstGuest,
            RoomScreenShareEvents.StateChanged);
        var secondRoomState = Capture<RoomScreenShareStateChanged>(
            secondGuest,
            RoomScreenShareEvents.StateChanged);

        await StartAndReceiveSnapshotAsync(firstHost);
        await StartAndReceiveSnapshotAsync(firstGuest);
        await StartAndReceiveSnapshotAsync(secondHost);
        await StartAndReceiveSnapshotAsync(secondGuest);

        await firstHost.InvokeAsync(nameof(RoomHub.SendScreenShareState), true);

        AssertScreenShareState(
            await firstRoomState.Task.WaitAsync(EventTimeout),
            firstHostSession,
            active: true,
            firstGuestSession.Credential,
            secondHostSession.Credential,
            secondGuestSession.Credential);
        await AssertNoSignalAsync(secondRoomState);
    }

    [Fact]
    public async Task Guest_cannot_send_screen_share_state_and_cannot_supply_authority()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var hostConnection = CreateHubConnection(factory, host);
        await using var guestConnection = CreateHubConnection(factory, guest);
        var unauthorizedState = Capture<RoomScreenShareStateChanged>(
            guestConnection,
            RoomScreenShareEvents.StateChanged);

        await StartAndReceiveSnapshotAsync(hostConnection);
        await StartAndReceiveSnapshotAsync(guestConnection);

        var exception = await Assert.ThrowsAsync<HubException>(
            () => guestConnection.InvokeAsync(nameof(RoomHub.SendScreenShareState), true));

        Assert.StartsWith(
            $"An unexpected error occurred invoking '{nameof(RoomHub.SendScreenShareState)}' on the server.",
            exception.Message,
            StringComparison.Ordinal);
        Assert.EndsWith(
            $"HubException: {RoomScreenShareStateChanged.InvalidRequestError}",
            exception.Message,
            StringComparison.Ordinal);
        await AssertNoSignalAsync(unauthorizedState);

        var authorizedState = Capture<RoomScreenShareStateChanged>(
            guestConnection,
            RoomScreenShareEvents.StateChanged);
        await hostConnection.InvokeAsync(nameof(RoomHub.SendScreenShareState), true);
        AssertScreenShareState(
            await authorizedState.Task.WaitAsync(EventTimeout),
            host,
            active: true,
            guest.Credential);
    }

    [Fact]
    public async Task Screen_share_state_with_no_Guest_online_is_not_replayed_later()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        await using var hostConnection = CreateHubConnection(factory, host);

        await StartAndReceiveSnapshotAsync(hostConnection);
        await hostConnection.InvokeAsync(nameof(RoomHub.SendScreenShareState), true);

        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var guestConnection = CreateHubConnection(factory, guest);
        var oldState = Capture<RoomScreenShareStateChanged>(
            guestConnection,
            RoomScreenShareEvents.StateChanged);

        await StartAndReceiveSnapshotAsync(guestConnection);

        await AssertNoSignalAsync(oldState);
    }

    [Fact]
    public async Task Browser_style_SDP_with_trailing_CRLF_is_relayed_verbatim_for_Offer_and_Answer()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var hostConnection = CreateHubConnection(factory, host);
        await using var guestConnection = CreateHubConnection(factory, guest);
        var offerReceived = Capture<RoomWebRtcOffer>(guestConnection, RoomWebRtcEvents.Offer);
        var answerReceived = Capture<RoomWebRtcAnswer>(hostConnection, RoomWebRtcEvents.Answer);

        await StartAndReceiveSnapshotAsync(hostConnection);
        await StartAndReceiveSnapshotAsync(guestConnection);

        await hostConnection.InvokeAsync("SendWebRtcOffer", OfferSdp);
        var offer = await offerReceived.Task.WaitAsync(EventTimeout);

        AssertOffer(offer, host, OfferSdp, guest.Credential);
        Assert.EndsWith("\r\n", offer.Sdp, StringComparison.Ordinal);
        Assert.Equal(OfferSdp, offer.Sdp);

        await guestConnection.InvokeAsync("SendWebRtcAnswer", AnswerSdp);
        var answer = await answerReceived.Task.WaitAsync(EventTimeout);

        AssertAnswer(answer, guest, AnswerSdp, host.Credential);
        Assert.EndsWith("\r\n", answer.Sdp, StringComparison.Ordinal);
        Assert.Equal(AnswerSdp, answer.Sdp);
    }

    [Fact]
    public async Task Offer_Answer_and_ICE_are_isolated_between_Rooms()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var firstHostSession = await CreateRoomAsync(client);
        var firstGuestSession = await JoinRoomAsync(client, firstHostSession.RoomId);
        var secondHostSession = await CreateRoomAsync(client);
        var secondGuestSession = await JoinRoomAsync(client, secondHostSession.RoomId);
        await using var firstHost = CreateHubConnection(factory, firstHostSession);
        await using var firstGuest = CreateHubConnection(factory, firstGuestSession);
        await using var secondHost = CreateHubConnection(factory, secondHostSession);
        await using var secondGuest = CreateHubConnection(factory, secondGuestSession);
        var firstRoomOffer = Capture<RoomWebRtcOffer>(firstGuest, RoomWebRtcEvents.Offer);
        var secondRoomOffer = Capture<RoomWebRtcOffer>(secondGuest, RoomWebRtcEvents.Offer);
        var firstRoomAnswer = Capture<RoomWebRtcAnswer>(firstHost, RoomWebRtcEvents.Answer);
        var secondRoomAnswer = Capture<RoomWebRtcAnswer>(secondHost, RoomWebRtcEvents.Answer);
        var firstRoomHostIce = Capture<RoomIceCandidate>(firstGuest, RoomWebRtcEvents.IceCandidate);
        var secondRoomGuestIce = Capture<RoomIceCandidate>(secondGuest, RoomWebRtcEvents.IceCandidate);
        var firstRoomGuestIce = Capture<RoomIceCandidate>(firstHost, RoomWebRtcEvents.IceCandidate);
        var secondRoomHostIce = Capture<RoomIceCandidate>(secondHost, RoomWebRtcEvents.IceCandidate);

        await StartAndReceiveSnapshotAsync(firstHost);
        await StartAndReceiveSnapshotAsync(firstGuest);
        await StartAndReceiveSnapshotAsync(secondHost);
        await StartAndReceiveSnapshotAsync(secondGuest);

        await firstHost.InvokeAsync("SendWebRtcOffer", OfferSdp);
        await firstRoomOffer.Task.WaitAsync(EventTimeout);
        await AssertNoSignalAsync(secondRoomOffer);

        await firstGuest.InvokeAsync("SendWebRtcAnswer", AnswerSdp);
        await firstRoomAnswer.Task.WaitAsync(EventTimeout);
        await AssertNoSignalAsync(secondRoomAnswer);

        await SendIceCandidateAsync(firstHost, HostCandidate, null, null, null);
        await firstRoomHostIce.Task.WaitAsync(EventTimeout);
        await AssertNoSignalAsync(secondRoomGuestIce);

        await SendIceCandidateAsync(firstGuest, GuestCandidate, null, null, null);
        await firstRoomGuestIce.Task.WaitAsync(EventTimeout);
        await AssertNoSignalAsync(secondRoomHostIce);
    }

    [Fact]
    public void Realtime_method_contracts_accept_no_authority_or_destination_parameters()
    {
        AssertMethodParameters(nameof(RoomHub.SendWebRtcOffer), ("sdp", typeof(string)));
        AssertMethodParameters(nameof(RoomHub.SendWebRtcAnswer), ("sdp", typeof(string)));
        AssertMethodParameters(
            nameof(RoomHub.SendIceCandidate),
            ("candidate", typeof(string)),
            ("sdpMid", typeof(string)),
            ("sdpMLineIndex", typeof(int?)),
            ("usernameFragment", typeof(string)));
        AssertMethodParameters(
            nameof(RoomHub.SendScreenShareState),
            ("active", typeof(bool)));
    }

    [Fact]
    public async Task Invalid_or_wrong_role_SDP_is_rejected_without_broadcasting_or_disconnecting()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var hostConnection = CreateHubConnection(factory, host);
        await using var guestConnection = CreateHubConnection(factory, guest);
        var offerReceived = Capture<RoomWebRtcOffer>(guestConnection, RoomWebRtcEvents.Offer);
        var answerReceived = Capture<RoomWebRtcAnswer>(hostConnection, RoomWebRtcEvents.Answer);

        await StartAndReceiveSnapshotAsync(hostConnection);
        await StartAndReceiveSnapshotAsync(guestConnection);

        foreach (var invalidSdp in new string?[]
                 {
                     null,
                     string.Empty,
                     " \t\r\n ",
                     new string('s', RoomWebRtcSignalingRules.MaximumSdpLength) + " ",
                 })
        {
            await AssertSignalRejectedAsync(
                "SendWebRtcOffer",
                invalidSdp,
                () => hostConnection.InvokeAsync("SendWebRtcOffer", invalidSdp));
            await AssertSignalRejectedAsync(
                "SendWebRtcAnswer",
                invalidSdp,
                () => guestConnection.InvokeAsync("SendWebRtcAnswer", invalidSdp));
        }

        await AssertSignalRejectedAsync(
            "SendWebRtcOffer",
            OfferSdp,
            () => guestConnection.InvokeAsync("SendWebRtcOffer", OfferSdp));
        await AssertSignalRejectedAsync(
            "SendWebRtcAnswer",
            AnswerSdp,
            () => hostConnection.InvokeAsync("SendWebRtcAnswer", AnswerSdp));
        await AssertNoSignalAsync(offerReceived);
        await AssertNoSignalAsync(answerReceived);

        await hostConnection.InvokeAsync("SendWebRtcOffer", OfferSdp);
        AssertOffer(
            await offerReceived.Task.WaitAsync(EventTimeout),
            host,
            OfferSdp,
            guest.Credential);

        await guestConnection.InvokeAsync("SendWebRtcAnswer", AnswerSdp);
        AssertAnswer(
            await answerReceived.Task.WaitAsync(EventTimeout),
            guest,
            AnswerSdp,
            host.Credential);
    }

    [Fact]
    public async Task Invalid_ICE_is_rejected_without_broadcast_and_boundary_input_succeeds()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var hostConnection = CreateHubConnection(factory, host);
        await using var guestConnection = CreateHubConnection(factory, guest);
        var candidateReceived = Capture<RoomIceCandidate>(guestConnection, RoomWebRtcEvents.IceCandidate);

        await StartAndReceiveSnapshotAsync(hostConnection);
        await StartAndReceiveSnapshotAsync(guestConnection);

        foreach (var invalidCandidate in new string?[]
                 {
                     null,
                     string.Empty,
                     " \t\r\n ",
                     new string('c', RoomWebRtcSignalingRules.MaximumCandidateLength) + " ",
                 })
        {
            await AssertSignalRejectedAsync(
                "SendIceCandidate",
                invalidCandidate,
                () => SendIceCandidateAsync(hostConnection, invalidCandidate, null, null, null));
        }

        await AssertSignalRejectedAsync(
            "SendIceCandidate",
            HostCandidate,
            () => SendIceCandidateAsync(hostConnection, HostCandidate, null, -1, null));
        await AssertSignalRejectedAsync(
            "SendIceCandidate",
            "oversized sdpMid",
            () => SendIceCandidateAsync(
                hostConnection,
                HostCandidate,
                new string('m', RoomWebRtcSignalingRules.MaximumSdpMidLength + 1),
                null,
                null));
        await AssertSignalRejectedAsync(
            "SendIceCandidate",
            "oversized usernameFragment",
            () => SendIceCandidateAsync(
                hostConnection,
                HostCandidate,
                null,
                null,
                new string('u', RoomWebRtcSignalingRules.MaximumUsernameFragmentLength + 1)));
        await AssertNoSignalAsync(candidateReceived);

        var boundaryCandidate = new string('c', RoomWebRtcSignalingRules.MaximumCandidateLength);
        await SendIceCandidateAsync(hostConnection, boundaryCandidate, "0", 0, "ufrag");

        AssertIceCandidate(
            await candidateReceived.Task.WaitAsync(EventTimeout),
            host,
            boundaryCandidate,
            "0",
            0,
            "ufrag",
            guest.Credential);
    }

    [Fact]
    public async Task Signals_with_no_peer_online_are_accepted_and_not_replayed_later()
    {
        using var factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        using var client = CreateHttpClient(factory);
        var host = await CreateRoomAsync(client);
        await using var hostConnection = CreateHubConnection(factory, host);

        await StartAndReceiveSnapshotAsync(hostConnection);
        await hostConnection.InvokeAsync("SendWebRtcOffer", OfferSdp);
        await SendIceCandidateAsync(hostConnection, HostCandidate, null, null, null);

        var guest = await JoinRoomAsync(client, host.RoomId);
        await using var guestConnection = CreateHubConnection(factory, guest);
        var oldOffer = Capture<RoomWebRtcOffer>(guestConnection, RoomWebRtcEvents.Offer);
        var oldCandidate = Capture<RoomIceCandidate>(guestConnection, RoomWebRtcEvents.IceCandidate);

        await StartAndReceiveSnapshotAsync(guestConnection);

        await AssertNoSignalAsync(oldOffer);
        await AssertNoSignalAsync(oldCandidate);
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

    private static async Task StartAndReceiveSnapshotAsync(HubConnection connection)
    {
        var snapshot = Capture<RoomPresenceSnapshot>(connection, RoomPresenceEvents.Snapshot);

        await connection.StartAsync();
        await snapshot.Task.WaitAsync(EventTimeout);
    }

    private static TaskCompletionSource<T> Capture<T>(HubConnection connection, string eventName)
    {
        var received = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<T>(eventName, value => received.TrySetResult(value));
        return received;
    }

    private static Task SendIceCandidateAsync(
        HubConnection connection,
        string? candidate,
        string? sdpMid,
        int? sdpMLineIndex,
        string? usernameFragment)
    {
        return connection.InvokeAsync(
            "SendIceCandidate",
            candidate,
            sdpMid,
            sdpMLineIndex,
            usernameFragment);
    }

    private static async Task AssertNoSignalAsync<T>(TaskCompletionSource<T> signalReceived)
    {
        var completed = await Task.WhenAny(signalReceived.Task, Task.Delay(NoEventTimeout));

        Assert.NotSame(signalReceived.Task, completed);
        Assert.False(signalReceived.Task.IsCompletedSuccessfully);
    }

    private static async Task AssertSignalRejectedAsync(
        string methodName,
        string? submittedContent,
        Func<Task> invocation)
    {
        var exception = await Assert.ThrowsAsync<HubException>(invocation);

        Assert.StartsWith(
            $"An unexpected error occurred invoking '{methodName}' on the server.",
            exception.Message,
            StringComparison.Ordinal);
        Assert.EndsWith(
            $"HubException: {RoomWebRtcSignalingRules.InvalidSignalError}",
            exception.Message,
            StringComparison.Ordinal);

        if (!string.IsNullOrEmpty(submittedContent))
        {
            Assert.False(
                exception.Message.Contains(submittedContent, StringComparison.Ordinal),
                "The client-visible signaling error contained submitted signaling content.");
        }
    }

    private static void AssertMethodParameters(
        string methodName,
        params (string Name, Type Type)[] expectedParameters)
    {
        var method = typeof(RoomHub).GetMethod(methodName);
        Assert.NotNull(method);
        var actualParameters = method.GetParameters();

        Assert.Equal(expectedParameters.Length, actualParameters.Length);

        for (var index = 0; index < expectedParameters.Length; index++)
        {
            Assert.Equal(expectedParameters[index].Name, actualParameters[index].Name);
            Assert.Equal(expectedParameters[index].Type, actualParameters[index].ParameterType);
        }
    }

    private static void AssertOffer(
        RoomWebRtcOffer offer,
        RoomSession sender,
        string sdp,
        params string[] otherCredentials)
    {
        Assert.Equal(sender.ParticipantId, offer.ParticipantId);
        Assert.Equal("Host", offer.Role);
        Assert.Equal(sdp, offer.Sdp);
        AssertPayload(
            offer,
            ["ParticipantId", "Role", "Sdp"],
            [sender.Credential, .. otherCredentials]);
    }

    private static void AssertAnswer(
        RoomWebRtcAnswer answer,
        RoomSession sender,
        string sdp,
        params string[] otherCredentials)
    {
        Assert.Equal(sender.ParticipantId, answer.ParticipantId);
        Assert.Equal("Guest", answer.Role);
        Assert.Equal(sdp, answer.Sdp);
        AssertPayload(
            answer,
            ["ParticipantId", "Role", "Sdp"],
            [sender.Credential, .. otherCredentials]);
    }

    private static void AssertIceCandidate(
        RoomIceCandidate iceCandidate,
        RoomSession sender,
        string candidate,
        string? sdpMid,
        int? sdpMLineIndex,
        string? usernameFragment,
        params string[] otherCredentials)
    {
        Assert.Equal(sender.ParticipantId, iceCandidate.ParticipantId);
        Assert.Equal(sender.Role, iceCandidate.Role);
        Assert.Equal(candidate, iceCandidate.Candidate);
        Assert.Equal(sdpMid, iceCandidate.SdpMid);
        Assert.Equal(sdpMLineIndex, iceCandidate.SdpMLineIndex);
        Assert.Equal(usernameFragment, iceCandidate.UsernameFragment);
        AssertPayload(
            iceCandidate,
            ["Candidate", "ParticipantId", "Role", "SdpMLineIndex", "SdpMid", "UsernameFragment"],
            [sender.Credential, .. otherCredentials]);
    }

    private static void AssertScreenShareState(
        RoomScreenShareStateChanged state,
        RoomSession sender,
        bool active,
        params string[] otherCredentials)
    {
        Assert.Equal(sender.ParticipantId, state.ParticipantId);
        Assert.Equal("Host", state.Role);
        Assert.Equal(active, state.Active);
        AssertPayload(
            state,
            ["Active", "ParticipantId", "Role"],
            [sender.Credential, .. otherCredentials]);
    }

    private static void AssertPayload(
        object payload,
        string[] expectedProperties,
        string[] credentials)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));
        var propertyNames = document.RootElement
            .EnumerateObject()
            .Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(expectedProperties, propertyNames);

        var serializedPayload = document.RootElement.GetRawText();
        foreach (var credential in credentials)
        {
            Assert.False(
                serializedPayload.Contains(credential, StringComparison.Ordinal),
                "A signaling payload contained a participant credential.");
        }
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
}
