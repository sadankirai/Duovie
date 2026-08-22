using Duovie.Application.ParticipantSessions;
using Duovie.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Duovie.Infrastructure.Persistence.Repositories;

public sealed class ParticipantSessionStore(DuovieDbContext dbContext) : IParticipantSessionStore
{
    private readonly DuovieDbContext _dbContext = dbContext
        ?? throw new ArgumentNullException(nameof(dbContext));

    public async Task AddAsync(
        ParticipantSessionRecord session,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);

        var entity = new ParticipantSessionEntity(
            session.Id,
            session.RoomId,
            session.ParticipantId,
            session.Role,
            session.TokenHash.ToArray(),
            session.IssuedAtUtc,
            session.ExpiresAtUtc);

        await _dbContext.ParticipantSessions.AddAsync(entity, cancellationToken);
    }

    public async Task<ParticipantSessionRecord?> GetByTokenHashAsync(
        byte[] tokenHash,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(tokenHash);

        var session = await _dbContext.ParticipantSessions
            .AsNoTracking()
            .SingleOrDefaultAsync(
                candidate => candidate.TokenHash == tokenHash,
                cancellationToken);

        return session is null
            ? null
            : new ParticipantSessionRecord(
                session.Id,
                session.RoomId,
                session.ParticipantId,
                session.Role,
                session.TokenHash.ToArray(),
                session.IssuedAtUtc,
                session.ExpiresAtUtc);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _dbContext.SaveChangesAsync(cancellationToken);
    }
}
