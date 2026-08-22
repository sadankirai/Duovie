using Duovie.Application.ParticipantSessions;
using Microsoft.EntityFrameworkCore.Storage;

namespace Duovie.Infrastructure.Persistence;

public sealed class RoomSessionTransaction(DuovieDbContext dbContext) : IRoomSessionTransaction
{
    private readonly DuovieDbContext _dbContext = dbContext
        ?? throw new ArgumentNullException(nameof(dbContext));

    public async Task<TResult> ExecuteAsync<TResult>(
        Func<CancellationToken, Task<TResult>> operation,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(operation);

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var result = await operation(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return result;
        }
        catch
        {
            await RollbackAsync(transaction);
            throw;
        }
    }

    private static async Task RollbackAsync(IDbContextTransaction transaction)
    {
        try
        {
            await transaction.RollbackAsync(CancellationToken.None);
        }
        catch
        {
            // Preserve the original operation failure.
        }
    }
}
