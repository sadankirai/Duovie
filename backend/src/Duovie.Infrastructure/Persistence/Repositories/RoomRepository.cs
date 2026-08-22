using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;
using Microsoft.EntityFrameworkCore;

namespace Duovie.Infrastructure.Persistence.Repositories;

public sealed class RoomRepository(DuovieDbContext dbContext) : IRoomRepository
{
    private readonly DuovieDbContext _dbContext = dbContext
        ?? throw new ArgumentNullException(nameof(dbContext));

    public Task<Room?> GetByIdAsync(Guid roomId, CancellationToken cancellationToken = default)
    {
        return _dbContext.Rooms.SingleOrDefaultAsync(
            room => room.Id == roomId,
            cancellationToken);
    }

    public async Task AddAsync(Room room, CancellationToken cancellationToken = default)
    {
        await _dbContext.Rooms.AddAsync(room, cancellationToken);
    }

    public async Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new RoomConcurrencyException(exception);
        }
    }
}
