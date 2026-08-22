namespace Duovie.Application.Rooms;

public sealed class RoomJoinRejectedException(Exception innerException)
    : Exception("The Room cannot currently accept a Guest.", innerException);
