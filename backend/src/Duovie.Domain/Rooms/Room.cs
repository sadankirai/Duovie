namespace Duovie.Domain.Rooms;

public sealed class Room
{
    private Room()
    {
    }

    private Room(
        Guid id,
        Guid hostId,
        DateTimeOffset createdAtUtc,
        DateTimeOffset expiresAtUtc)
    {
        Id = id;
        HostId = hostId;
        CreatedAtUtc = createdAtUtc;
        ExpiresAtUtc = expiresAtUtc;
        Status = RoomStatus.WaitingForGuest;
    }

    public Guid Id { get; private set; }

    public Guid HostId { get; private set; }

    public Guid? GuestId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset ExpiresAtUtc { get; private set; }

    public DateTimeOffset? ClosedAtUtc { get; private set; }

    public RoomStatus Status { get; private set; }

    public int ParticipantCount => GuestId.HasValue ? 2 : 1;

    public static Room Create(
        Guid id,
        Guid hostId,
        DateTimeOffset createdAtUtc,
        DateTimeOffset expiresAtUtc)
    {
        EnsureIdentity(id, nameof(id), "Room identifier cannot be empty.");
        EnsureIdentity(hostId, nameof(hostId), "Host identifier cannot be empty.");
        EnsureUtc(createdAtUtc, nameof(createdAtUtc));
        EnsureUtc(expiresAtUtc, nameof(expiresAtUtc));

        if (expiresAtUtc <= createdAtUtc)
        {
            throw new ArgumentOutOfRangeException(
                nameof(expiresAtUtc),
                "Room expiration must be later than creation.");
        }

        return new Room(id, hostId, createdAtUtc, expiresAtUtc);
    }

    public void AddGuest(Guid guestId, DateTimeOffset currentUtc)
    {
        EnsureIdentity(guestId, nameof(guestId), "Guest identifier cannot be empty.");
        EnsureOperationTime(currentUtc, nameof(currentUtc));

        if (guestId == HostId)
        {
            throw new InvalidOperationException("The Host cannot join as the Guest.");
        }

        if (Status == RoomStatus.Closed)
        {
            throw new InvalidOperationException("A closed room cannot accept a Guest.");
        }

        if (IsExpired(currentUtc))
        {
            throw new InvalidOperationException("An expired room cannot accept a Guest.");
        }

        if (GuestId.HasValue)
        {
            throw new InvalidOperationException("The room already has a Guest.");
        }

        GuestId = guestId;
        Status = RoomStatus.Ready;
    }

    public void Close(DateTimeOffset closedAtUtc)
    {
        EnsureOperationTime(closedAtUtc, nameof(closedAtUtc));

        if (Status == RoomStatus.Closed)
        {
            return;
        }

        ClosedAtUtc = closedAtUtc;
        Status = RoomStatus.Closed;
    }

    public bool IsExpired(DateTimeOffset currentUtc)
    {
        EnsureOperationTime(currentUtc, nameof(currentUtc));

        return currentUtc >= ExpiresAtUtc;
    }

    private void EnsureOperationTime(DateTimeOffset value, string parameterName)
    {
        EnsureUtc(value, parameterName);

        if (value < CreatedAtUtc)
        {
            throw new ArgumentOutOfRangeException(
                parameterName,
                "Room operations cannot occur before room creation.");
        }
    }

    private static void EnsureIdentity(Guid value, string parameterName, string message)
    {
        if (value == Guid.Empty)
        {
            throw new ArgumentException(message, parameterName);
        }
    }

    private static void EnsureUtc(DateTimeOffset value, string parameterName)
    {
        if (value.Offset != TimeSpan.Zero)
        {
            throw new ArgumentException("Room timestamps must use the UTC offset.", parameterName);
        }
    }
}
