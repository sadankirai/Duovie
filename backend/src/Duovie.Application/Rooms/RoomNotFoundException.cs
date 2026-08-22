namespace Duovie.Application.Rooms;

public sealed class RoomNotFoundException(Guid roomId)
    : Exception($"Room '{roomId}' was not found.")
{
    public Guid RoomId { get; } = roomId;
}
