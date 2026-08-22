using Duovie.Domain.Rooms;

namespace Duovie.Application.Rooms;

public interface IRoomRepository
{
    Task<Room?> GetByIdAsync(Guid roomId, CancellationToken cancellationToken = default);

    Task AddAsync(Room room, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
