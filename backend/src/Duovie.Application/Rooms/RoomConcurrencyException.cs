namespace Duovie.Application.Rooms;

public sealed class RoomConcurrencyException(Exception innerException)
    : Exception("The Room was changed by another operation.", innerException)
{
}
