namespace Duovie.Api.Contracts.Rooms;

public sealed record RoomSessionResponse(
    RoomResponse Room,
    ParticipantResponse Participant);

public sealed record RoomResponse(
    Guid Id,
    string Status,
    DateTimeOffset ExpiresAtUtc);

public sealed record ParticipantResponse(
    Guid Id,
    string Role,
    string Credential,
    DateTimeOffset ExpiresAtUtc);
