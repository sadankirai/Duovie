namespace Duovie.Application.ParticipantSessions;

public interface IParticipantSessionStore
{
    Task AddAsync(
        ParticipantSessionRecord session,
        CancellationToken cancellationToken = default);

    Task<ParticipantSessionRecord?> GetByTokenHashAsync(
        byte[] tokenHash,
        CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
