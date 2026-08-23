namespace Duovie.Api.Realtime;

public sealed record RoomChatMessage(
    Guid MessageId,
    Guid ParticipantId,
    string Role,
    string Text,
    DateTimeOffset SentAtUtc)
{
    public const int MaximumTextLength = 2000;

    public const string InvalidMessageError = "Chat message is invalid.";
}

