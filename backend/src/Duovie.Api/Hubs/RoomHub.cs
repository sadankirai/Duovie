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
}
