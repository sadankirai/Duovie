using Duovie.Api.Configuration;
using Duovie.Api.Errors;
using Duovie.Api.Hubs;
using Duovie.Api.Realtime;
using Duovie.Infrastructure;
using Duovie.Infrastructure.Persistence;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<RoomExceptionHandler>();
builder.Services.AddOptions<RoomOptions>()
    .Bind(builder.Configuration.GetSection(RoomOptions.ConfigurationSectionName))
    .Validate(
        options => options.Lifetime > TimeSpan.Zero,
        $"Configuration value '{RoomOptions.LifetimeConfigurationKey}' must be a positive TimeSpan.")
    .ValidateOnStart();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddSingleton<IRoomPresenceRegistry, RoomPresenceRegistry>();
builder.Services.AddAuthorization();
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddDbContextCheck<DuovieDbContext>(name: "postgresql", tags: ["ready"]);

var app = builder.Build();
app.UseExceptionHandler();
app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();
app.MapHub<RoomHub>("/hubs/room");
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains("live"),
});
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains("ready"),
});
app.Run();

public partial class Program;
