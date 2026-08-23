namespace Duovie.Api.Realtime;

public static class RoomScreenShareEvents
{
    public const string StateChanged = "RoomScreenShareStateChanged";
}

public sealed record RoomScreenShareStateChanged(
    Guid ParticipantId,
    string Role,
    bool Active)
{
    public const string InvalidRequestError = "Screen-share state request is invalid.";
}
