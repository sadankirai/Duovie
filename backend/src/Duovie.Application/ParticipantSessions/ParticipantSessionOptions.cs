namespace Duovie.Application.ParticipantSessions;

public sealed class ParticipantSessionOptions
{
    public const string ConfigurationSectionName = "ParticipantSessions";
    public const string LifetimeConfigurationKey = ConfigurationSectionName + ":Lifetime";

    public ParticipantSessionOptions(TimeSpan lifetime)
    {
        if (lifetime <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(
                nameof(lifetime),
                "Participant session lifetime must be positive.");
        }

        Lifetime = lifetime;
    }

    public TimeSpan Lifetime { get; }
}
