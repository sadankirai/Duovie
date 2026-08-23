using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Duovie.IntegrationTests;

internal sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<string> _messages = new();

    public IReadOnlyCollection<string> Messages => _messages.ToArray();

    public ILogger CreateLogger(string categoryName)
    {
        return new CapturingLogger(categoryName, _messages);
    }

    public void Dispose()
    {
    }

    private sealed class CapturingLogger(
        string categoryName,
        ConcurrentQueue<string> messages) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull
        {
            return null;
        }

        public bool IsEnabled(LogLevel logLevel)
        {
            return true;
        }

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var message = formatter(state, exception);

            if (exception is not null)
            {
                message += Environment.NewLine + exception;
            }

            messages.Enqueue($"{categoryName}:{logLevel}:{message}");
        }
    }
}
