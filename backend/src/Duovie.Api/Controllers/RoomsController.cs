using Duovie.Api.Configuration;
using Duovie.Api.Contracts.Rooms;
using Duovie.Application.ParticipantSessions;
using Duovie.Domain.Rooms;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Duovie.Api.Controllers;

[ApiController]
[Route("api/rooms")]
public sealed class RoomsController(
    CreateRoomSession createRoomSession,
    JoinRoomSession joinRoomSession,
    IOptions<RoomOptions> roomOptions,
    TimeProvider timeProvider) : ControllerBase
{
    private readonly CreateRoomSession _createRoomSession = createRoomSession
        ?? throw new ArgumentNullException(nameof(createRoomSession));

    private readonly JoinRoomSession _joinRoomSession = joinRoomSession
        ?? throw new ArgumentNullException(nameof(joinRoomSession));

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
}
