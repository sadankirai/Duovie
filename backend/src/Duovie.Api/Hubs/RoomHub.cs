using Duovie.Api.Realtime;
using Duovie.Application.ParticipantSessions;
using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Net.Http.Headers;

namespace Duovie.Api.Hubs;

public sealed class RoomHub(
    ParticipantSessionService participantSessionService,
    IRoomRepository roomRepository,
    IRoomPresenceRegistry presenceRegistry,
    TimeProvider timeProvider) : Hub
{
    private const string ConnectionIdentityItemKey = "Duovie.RoomHub.ConnectionIdentity";

    private readonly ParticipantSessionService _participantSessionService = participantSessionService
        ?? throw new ArgumentNullException(nameof(participantSessionService));

    private readonly IRoomRepository _roomRepository = roomRepository
        ?? throw new ArgumentNullException(nameof(roomRepository));

    private readonly IRoomPresenceRegistry _presenceRegistry = presenceRegistry
        ?? throw new ArgumentNullException(nameof(presenceRegistry));

    private readonly TimeProvider _timeProvider = timeProvider
        ?? throw new ArgumentNullException(nameof(timeProvider));

    public override async Task OnConnectedAsync()
    {
        var request = Context.GetHttpContext()?.Request;
        var roomId = TryGetRoomId(request);
        var credential = GetParticipantCredential(request);

        if (roomId is null || string.IsNullOrWhiteSpace(credential))
        {
            Context.Abort();
            return;
        }

        ValidatedParticipantSession session;

        try
        {
            session = await _participantSessionService.ValidateAsync(
                credential,
                roomId.Value,
                Context.ConnectionAborted);
        }
        catch (ParticipantSessionInvalidException)
        {
            Context.Abort();
            return;
        }

        var room = await _roomRepository.GetByIdAsync(roomId.Value, Context.ConnectionAborted);

        if (room is null
            || room.Status == RoomStatus.Closed
            || room.IsExpired(_timeProvider.GetUtcNow()))
        {
            Context.Abort();
            return;
        }

        var identity = new RoomHubConnectionIdentity(
            session.RoomId,
            session.ParticipantId,
            session.Role);
        var groupName = GetRoomGroupName(identity.RoomId);

        Context.Items[ConnectionIdentityItemKey] = identity;
        await Groups.AddToGroupAsync(Context.ConnectionId, groupName, Context.ConnectionAborted);
        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            GetRoomRoleGroupName(identity.RoomId, identity.Role),
            Context.ConnectionAborted);

        var becameOnline = _presenceRegistry.Add(identity, Context.ConnectionId);
        var snapshot = new RoomPresenceSnapshot(_presenceRegistry.GetSnapshot(identity.RoomId));

        await Clients.Caller.SendAsync(
            RoomPresenceEvents.Snapshot,
            snapshot,
            Context.ConnectionAborted);

        if (becameOnline)
        {
            await Clients.OthersInGroup(groupName).SendAsync(
                RoomPresenceEvents.Changed,
                identity.ToPresenceParticipant(connected: true),
                Context.ConnectionAborted);
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.Items.TryGetValue(ConnectionIdentityItemKey, out var value)
            && value is RoomHubConnectionIdentity identity
            && _presenceRegistry.Remove(identity, Context.ConnectionId))
        {
            await Clients.OthersInGroup(GetRoomGroupName(identity.RoomId)).SendAsync(
                RoomPresenceEvents.Changed,
                identity.ToPresenceParticipant(connected: false),
                CancellationToken.None);
        }

        await base.OnDisconnectedAsync(exception);
    }

    public async Task SendChatMessage(string? text)
    {
        var normalizedText = NormalizeChatText(text);
        var identity = GetConnectionIdentity(RoomChatMessage.InvalidMessageError);
        var message = new RoomChatMessage(
            Guid.NewGuid(),
            identity.ParticipantId,
            identity.Role.ToString(),
            normalizedText,
            _timeProvider.GetUtcNow());

        await Clients.Group(GetRoomGroupName(identity.RoomId)).SendAsync(
            RoomChatEvents.Message,
            message,
            Context.ConnectionAborted);
    }

    public async Task SendWebRtcOffer(string? sdp)
    {
        var identity = GetConnectionIdentity(RoomWebRtcSignalingRules.InvalidSignalError);
        EnsureRole(identity, ParticipantRole.Host);
        var validatedSdp = ValidateRequiredOpaqueSignal(
            sdp,
            RoomWebRtcSignalingRules.MaximumSdpLength);
        var offer = new RoomWebRtcOffer(
            identity.ParticipantId,
            identity.Role.ToString(),
            validatedSdp);

        await Clients.Group(GetRoomRoleGroupName(identity.RoomId, ParticipantRole.Guest)).SendAsync(
            RoomWebRtcEvents.Offer,
            offer,
            Context.ConnectionAborted);
    }

    public async Task SendWebRtcAnswer(string? sdp)
    {
        var identity = GetConnectionIdentity(RoomWebRtcSignalingRules.InvalidSignalError);
        EnsureRole(identity, ParticipantRole.Guest);
        var validatedSdp = ValidateRequiredOpaqueSignal(
            sdp,
            RoomWebRtcSignalingRules.MaximumSdpLength);
        var answer = new RoomWebRtcAnswer(
            identity.ParticipantId,
            identity.Role.ToString(),
            validatedSdp);

        await Clients.Group(GetRoomRoleGroupName(identity.RoomId, ParticipantRole.Host)).SendAsync(
            RoomWebRtcEvents.Answer,
            answer,
            Context.ConnectionAborted);
    }

    public async Task SendIceCandidate(
        string? candidate,
        string? sdpMid,
        int? sdpMLineIndex,
        string? usernameFragment)
    {
        var identity = GetConnectionIdentity(RoomWebRtcSignalingRules.InvalidSignalError);
        var validatedCandidate = ValidateRequiredOpaqueSignal(
            candidate,
            RoomWebRtcSignalingRules.MaximumCandidateLength);
        var validatedSdpMid = ValidateOptionalOpaqueSignal(
            sdpMid,
            RoomWebRtcSignalingRules.MaximumSdpMidLength);
        var validatedUsernameFragment = ValidateOptionalOpaqueSignal(
            usernameFragment,
            RoomWebRtcSignalingRules.MaximumUsernameFragmentLength);

        if (sdpMLineIndex < 0)
        {
            throw new HubException(RoomWebRtcSignalingRules.InvalidSignalError);
        }

        var iceCandidate = new RoomIceCandidate(
            identity.ParticipantId,
            identity.Role.ToString(),
            validatedCandidate,
            validatedSdpMid,
            sdpMLineIndex,
            validatedUsernameFragment);

        await Clients.Group(GetRoomRoleGroupName(
                identity.RoomId,
                GetOppositeRole(identity.Role)))
            .SendAsync(
                RoomWebRtcEvents.IceCandidate,
                iceCandidate,
                Context.ConnectionAborted);
    }

    public async Task RequestWebRtcRecovery()
    {
        var identity = GetConnectionIdentity(RoomWebRtcSignalingRules.InvalidSignalError);
        var request = new RoomWebRtcRecoveryRequested(
            identity.ParticipantId,
            identity.Role.ToString());

        await Clients.Group(GetRoomRoleGroupName(
                identity.RoomId,
                GetOppositeRole(identity.Role)))
            .SendAsync(
                RoomWebRtcEvents.RecoveryRequested,
                request,
                Context.ConnectionAborted);
    }

    public async Task SendScreenShareState(bool active)
    {
        var identity = GetConnectionIdentity(RoomScreenShareStateChanged.InvalidRequestError);

        if (identity.Role != ParticipantRole.Host)
        {
            throw new HubException(RoomScreenShareStateChanged.InvalidRequestError);
        }

        var state = new RoomScreenShareStateChanged(
            identity.ParticipantId,
            identity.Role.ToString(),
            active);

        await Clients.Group(GetRoomRoleGroupName(identity.RoomId, ParticipantRole.Guest)).SendAsync(
            RoomScreenShareEvents.StateChanged,
            state,
            Context.ConnectionAborted);
    }

    private static Guid? TryGetRoomId(HttpRequest? request)
    {
        if (request is null
            || !request.Query.TryGetValue("roomId", out var values)
            || values.Count != 1
            || !Guid.TryParse(values[0], out var roomId)
            || roomId == Guid.Empty)
        {
            return null;
        }

        return roomId;
    }

    private RoomHubConnectionIdentity GetConnectionIdentity(string errorMessage)
    {
        if (Context.Items.TryGetValue(ConnectionIdentityItemKey, out var value)
            && value is RoomHubConnectionIdentity identity)
        {
            return identity;
        }

        throw new HubException(errorMessage);
    }

    private static void EnsureRole(
        RoomHubConnectionIdentity identity,
        ParticipantRole requiredRole)
    {
        if (identity.Role != requiredRole)
        {
            throw new HubException(RoomWebRtcSignalingRules.InvalidSignalError);
        }
    }

    private static string ValidateRequiredOpaqueSignal(string? value, int maximumLength)
    {
        if (string.IsNullOrEmpty(value)
            || string.IsNullOrWhiteSpace(value)
            || value.Length > maximumLength)
        {
            throw new HubException(RoomWebRtcSignalingRules.InvalidSignalError);
        }

        return value;
    }

    private static string? ValidateOptionalOpaqueSignal(string? value, int maximumLength)
    {
        if (value is null)
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
        {
            throw new HubException(RoomWebRtcSignalingRules.InvalidSignalError);
        }

        return value;
    }

    private static string NormalizeChatText(string? text)
    {
        var normalizedText = text?.Trim();

        if (string.IsNullOrEmpty(normalizedText)
            || normalizedText.Length > RoomChatMessage.MaximumTextLength)
        {
            throw new HubException(RoomChatMessage.InvalidMessageError);
        }

        return normalizedText;
    }

    private static string? GetParticipantCredential(HttpRequest? request)
    {
        if (request is null)
        {
            return null;
        }

        if (request.Query.TryGetValue("access_token", out var accessTokens)
            && accessTokens.Count == 1
            && !string.IsNullOrWhiteSpace(accessTokens[0]))
        {
            return accessTokens[0];
        }

        var authorization = request.Headers[HeaderNames.Authorization].ToString();
        const string bearerPrefix = "Bearer ";

        return authorization.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase)
            ? authorization[bearerPrefix.Length..]
            : null;
    }

    private static string GetRoomGroupName(Guid roomId)
    {
        return $"room:{roomId:N}";
    }

    private static string GetRoomRoleGroupName(Guid roomId, ParticipantRole role)
    {
        var roleName = role switch
        {
            ParticipantRole.Host => "host",
            ParticipantRole.Guest => "guest",
            _ => throw new ArgumentOutOfRangeException(nameof(role)),
        };

        return $"room:{roomId:N}:{roleName}";
    }

    private static ParticipantRole GetOppositeRole(ParticipantRole role)
    {
        return role switch
        {
            ParticipantRole.Host => ParticipantRole.Guest,
            ParticipantRole.Guest => ParticipantRole.Host,
            _ => throw new ArgumentOutOfRangeException(nameof(role)),
        };
    }
}
