using Duovie.Application.ParticipantSessions;

namespace Duovie.UnitTests;

internal sealed class ParticipantSessionStoreSpy : IParticipantSessionStore
{
    private readonly Dictionary<string, ParticipantSessionRecord> _sessions = [];

    public IReadOnlyCollection<ParticipantSessionRecord> AddedSessions => _sessions.Values;

    public int SaveChangesCallCount { get; private set; }

    public Task AddAsync(
        ParticipantSessionRecord session,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _sessions.Add(Convert.ToHexString(session.TokenHash), session);

        return Task.CompletedTask;
    }

    public Task<ParticipantSessionRecord?> GetByTokenHashAsync(
        byte[] tokenHash,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _sessions.TryGetValue(Convert.ToHexString(tokenHash), out var session);

        return Task.FromResult(session);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveChangesCallCount++;

        return Task.CompletedTask;
    }

    public void Seed(ParticipantSessionRecord session)
    {
        _sessions.Add(Convert.ToHexString(session.TokenHash), session);
    }
}

internal sealed class ImmediateRoomSessionTransaction : IRoomSessionTransaction
{
    public int ExecuteCallCount { get; private set; }

    public Task<TResult> ExecuteAsync<TResult>(
        Func<CancellationToken, Task<TResult>> operation,
        CancellationToken cancellationToken = default)
    {
        ExecuteCallCount++;
        return operation(cancellationToken);
    }
}
