namespace Duovie.Api.Configuration;

public sealed class RoomOptions
{
    public const string ConfigurationSectionName = "Rooms";
    public const string LifetimeConfigurationKey = ConfigurationSectionName + ":Lifetime";

    public TimeSpan Lifetime { get; init; }
}
