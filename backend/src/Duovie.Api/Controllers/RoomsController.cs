using Duovie.Api.Configuration;
using Duovie.Api.Contracts.IceServers;
using Duovie.Api.Contracts.Rooms;
using Duovie.Application.IceServers;
using Duovie.Application.ParticipantSessions;
using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Duovie.Api.Controllers;

[ApiController]
[Route("api/rooms")]
public sealed class RoomsController(
    CreateRoomSession createRoomSession,
    JoinRoomSession joinRoomSession,
    ParticipantSessionService participantSessionService,
    IRoomRepository roomRepository,
    IIceServerProvisioningService iceServerProvisioningService,
    IOptions<RoomOptions> roomOptions,
    TimeProvider timeProvider) : ControllerBase
{
    private readonly CreateRoomSession _createRoomSession = createRoomSession
        ?? throw new ArgumentNullException(nameof(createRoomSession));

    private readonly JoinRoomSession _joinRoomSession = joinRoomSession
        ?? throw new ArgumentNullException(nameof(joinRoomSession));

    private readonly ParticipantSessionService _participantSessionService = participantSessionService
        ?? throw new ArgumentNullException(nameof(participantSessionService));

    private readonly IRoomRepository _roomRepository = roomRepository
        ?? throw new ArgumentNullException(nameof(roomRepository));

    private readonly IIceServerProvisioningService _iceServerProvisioningService = iceServerProvisioningService
        ?? throw new ArgumentNullException(nameof(iceServerProvisioningService));

    private readonly RoomOptions _roomOptions = roomOptions?.Value
        ?? throw new ArgumentNullException(nameof(roomOptions));

    private readonly TimeProvider _timeProvider = timeProvider
        ?? throw new ArgumentNullException(nameof(timeProvider));

    [HttpPost]
    [ProducesResponseType<RoomSessionResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<RoomSessionResponse>> CreateAsync(
        CancellationToken cancellationToken)
    {
        var roomExpiresAtUtc = _timeProvider.GetUtcNow().Add(_roomOptions.Lifetime);
        var result = await _createRoomSession.ExecuteAsync(
            roomExpiresAtUtc,
            cancellationToken);

        SetCredentialResponseCachePolicy();

        return StatusCode(
            StatusCodes.Status201Created,
            ToResponse(result.Room, result.Session));
    }

    [HttpPost("{roomId}/join")]
    [ProducesResponseType<RoomSessionResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<RoomSessionResponse>> JoinAsync(
        Guid roomId,
        CancellationToken cancellationToken)
    {
        var result = await _joinRoomSession.ExecuteAsync(roomId, cancellationToken);

        SetCredentialResponseCachePolicy();

        return Ok(ToResponse(result.Room, result.Session));
    }

    [HttpGet("{roomId:guid}/session")]
    [ProducesResponseType<ResumedRoomSessionResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<ResumedRoomSessionResponse>> ResumeSessionAsync(
        Guid roomId,
        CancellationToken cancellationToken)
    {
        SetCredentialResponseCachePolicy();

        ValidatedParticipantSession session;

        try
        {
            session = await _participantSessionService.ValidateAsync(
                GetBearerCredential(),
                roomId,
                cancellationToken);
        }
        catch (ParticipantSessionInvalidException)
        {
            return InvalidParticipantSession();
        }

        var room = await _roomRepository.GetByIdAsync(roomId, cancellationToken);
        if (room is null
            || room.Status == RoomStatus.Closed
            || room.IsExpired(_timeProvider.GetUtcNow())
            || !SessionMatchesRoom(session, room))
        {
            return InvalidParticipantSession();
        }

        return Ok(new ResumedRoomSessionResponse(
            new ResumedRoomResponse(room.Id),
            new ResumedParticipantResponse(
                session.ParticipantId,
                session.Role.ToString())));
    }

    [HttpGet("{roomId:guid}/ice-servers")]
    [ProducesResponseType<IceServersResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IceServersResponse>> GetIceServersAsync(
        Guid roomId,
        CancellationToken cancellationToken)
    {
        SetCredentialResponseCachePolicy();

        ValidatedParticipantSession session;

        try
        {
            session = await _participantSessionService.ValidateAsync(
                GetBearerCredential(),
                roomId,
                cancellationToken);
        }
        catch (ParticipantSessionInvalidException)
        {
            return InvalidParticipantSession();
        }

        var room = await _roomRepository.GetByIdAsync(roomId, cancellationToken);
        if (room is null
            || room.Status == RoomStatus.Closed
            || room.IsExpired(_timeProvider.GetUtcNow())
            || !SessionMatchesRoom(session, room))
        {
            return InvalidParticipantSession();
        }

        var iceServers = await _iceServerProvisioningService.GetIceServersAsync(cancellationToken);

        return Ok(new IceServersResponse(
            iceServers
                .Select(server => new IceServerResponse(server.Urls, server.Username, server.Credential))
                .ToList()));
    }

    private static RoomSessionResponse ToResponse(
        Room room,
        IssuedParticipantSession session)
    {
        return new RoomSessionResponse(
            new RoomResponse(
                room.Id,
                room.Status.ToString(),
                room.ExpiresAtUtc),
            new ParticipantResponse(
                session.ParticipantId,
                session.Role.ToString(),
                session.Credential,
                session.ExpiresAtUtc));
    }

    private void SetCredentialResponseCachePolicy()
    {
        Response.Headers.CacheControl = "no-store";
    }

    private string? GetBearerCredential()
    {
        var authorization = Request.Headers[HeaderNames.Authorization].ToString();
        const string bearerPrefix = "Bearer ";

        if (!authorization.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var credential = authorization[bearerPrefix.Length..];
        return string.IsNullOrWhiteSpace(credential) ? null : credential;
    }

    private UnauthorizedObjectResult InvalidParticipantSession()
    {
        return Unauthorized(new ProblemDetails
        {
            Status = StatusCodes.Status401Unauthorized,
            Title = "Participant session is invalid.",
        });
    }

    private static bool SessionMatchesRoom(
        ValidatedParticipantSession session,
        Room room)
    {
        return session.Role switch
        {
            ParticipantRole.Host => session.ParticipantId == room.HostId,
            ParticipantRole.Guest => session.ParticipantId == room.GuestId,
            _ => false,
        };
    }
}
