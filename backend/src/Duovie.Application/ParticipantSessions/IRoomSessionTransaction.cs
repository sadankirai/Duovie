namespace Duovie.Application.ParticipantSessions;

public interface IRoomSessionTransaction
{
    Task<TResult> ExecuteAsync<TResult>(
        Func<CancellationToken, Task<TResult>> operation,
        CancellationToken cancellationToken = default);
}
