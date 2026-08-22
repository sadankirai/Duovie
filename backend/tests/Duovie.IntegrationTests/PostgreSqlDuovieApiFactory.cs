using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;
using Duovie.Infrastructure.Persistence;
using Duovie.Infrastructure.Persistence.Repositories;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Duovie.IntegrationTests;

public sealed class PostgreSqlDuovieApiFactory : WebApplicationFactory<Program>
{
    private const string SessionLifetime = "00:30:00";
    private const string RoomLifetime = "02:00:00";
    private readonly string _connectionString;
    private readonly TwoRoomLoadCoordinator? _roomLoadCoordinator;

    public PostgreSqlDuovieApiFactory(
        string connectionString,
        bool coordinateTwoRoomLoads = false)
    {
        _connectionString = connectionString;
        _roomLoadCoordinator = coordinateTwoRoomLoads
            ? new TwoRoomLoadCoordinator()
            : null;
    }

    public static DateTimeOffset UtcNow { get; } =
        new(2026, 8, 22, 15, 0, 0, TimeSpan.Zero);

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:DefaultConnection", _connectionString);
        builder.UseSetting("ParticipantSessions:Lifetime", SessionLifetime);
        builder.UseSetting("Rooms:Lifetime", RoomLifetime);
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.Sources.Clear();
            configuration.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:DefaultConnection"] = _connectionString,
                    ["ParticipantSessions:Lifetime"] = SessionLifetime,
                    ["Rooms:Lifetime"] = RoomLifetime,
                });
        });
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DuovieDbContext>();
            services.RemoveAll<DbContextOptions<DuovieDbContext>>();
            services.AddDbContext<DuovieDbContext>(options => options.UseNpgsql(_connectionString));
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(new FixedTimeProvider(UtcNow));

            if (_roomLoadCoordinator is not null)
            {
                services.RemoveAll<IRoomRepository>();
                services.AddScoped<IRoomRepository>(serviceProvider =>
                    new CoordinatedRoomRepository(
                        new RoomRepository(serviceProvider.GetRequiredService<DuovieDbContext>()),
                        _roomLoadCoordinator));
            }
        });
    }

    private sealed class FixedTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow()
        {
            return utcNow;
        }
    }

    private sealed class TwoRoomLoadCoordinator
    {
        private readonly TaskCompletionSource _bothLoaded = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private int _loadCount;

        public async Task ArriveAndWaitAsync(CancellationToken cancellationToken)
        {
            if (Interlocked.Increment(ref _loadCount) == 2)
            {
                _bothLoaded.TrySetResult();
            }

            await _bothLoaded.Task.WaitAsync(cancellationToken);
        }
    }

    private sealed class CoordinatedRoomRepository(
        IRoomRepository inner,
        TwoRoomLoadCoordinator coordinator) : IRoomRepository
    {
        public async Task<Room?> GetByIdAsync(
            Guid roomId,
            CancellationToken cancellationToken = default)
        {
            var room = await inner.GetByIdAsync(roomId, cancellationToken);
            await coordinator.ArriveAndWaitAsync(cancellationToken);

            return room;
        }

        public Task AddAsync(Room room, CancellationToken cancellationToken = default)
        {
            return inner.AddAsync(room, cancellationToken);
        }

        public Task SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            return inner.SaveChangesAsync(cancellationToken);
        }
    }
}
