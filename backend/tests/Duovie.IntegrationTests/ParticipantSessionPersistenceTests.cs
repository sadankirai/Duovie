using System.Buffers.Text;
using System.Security.Cryptography;
using Duovie.Application.ParticipantSessions;
using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;
using Duovie.Infrastructure.Persistence;
using Duovie.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Duovie.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public class ParticipantSessionPersistenceTests(PostgreSqlFixture fixture)
{
    private static readonly DateTimeOffset NowUtc = new(2026, 8, 22, 12, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromMinutes(30);

    [Fact]
    public async Task Create_flow_atomically_persists_a_Room_and_its_bound_Host_session()
    {
        CreateRoomSessionResult created;

        await using (var dbContext = fixture.CreateDbContext())
        {
            var roomRepository = new RoomRepository(dbContext);
            var sessionStore = new ParticipantSessionStore(dbContext);
            var flow = new CreateRoomSession(
                new CreateRoom(roomRepository, new FixedTimeProvider(NowUtc)),
                CreateSessionService(sessionStore),
                new RoomSessionTransaction(dbContext));

            created = await flow.ExecuteAsync(NowUtc.AddHours(2));
        }

        await using var verificationContext = fixture.CreateDbContext();
        var room = await new RoomRepository(verificationContext).GetByIdAsync(created.Room.Id);
        var session = await verificationContext.ParticipantSessions
            .AsNoTracking()
            .SingleAsync(candidate => candidate.RoomId == created.Room.Id);

        Assert.NotNull(room);
        Assert.Equal(room.HostId, created.Session.ParticipantId);
        Assert.Equal(room.HostId, session.ParticipantId);
        Assert.Equal(ParticipantRole.Host, session.Role);

        var validator = CreateSessionService(new ParticipantSessionStore(verificationContext));
        var trusted = await validator.ValidateAsync(created.Session.Credential, created.Room.Id);
        Assert.Equal(room.HostId, trusted.ParticipantId);
    }

    [Fact]
    public async Task Persistence_contains_the_credential_hash_but_no_raw_credential_column()
    {
        var room = CreateWaitingRoom();
        IssuedParticipantSession issued;

        await using (var dbContext = fixture.CreateDbContext())
        {
            var roomRepository = new RoomRepository(dbContext);
            await roomRepository.AddAsync(room);
            await roomRepository.SaveChangesAsync();

            issued = await CreateSessionService(new ParticipantSessionStore(dbContext))
                .IssueAsync(room.Id, room.HostId, ParticipantRole.Host);
        }

        await using var verificationContext = fixture.CreateDbContext();
        var persisted = await verificationContext.ParticipantSessions
            .AsNoTracking()
            .SingleAsync(session => session.RoomId == room.Id);
        var rawToken = Base64Url.DecodeFromChars(issued.Credential);

        Assert.Equal(SHA256.HashData(rawToken), persisted.TokenHash);
        Assert.NotEqual(rawToken, persisted.TokenHash);

        var connection = (NpgsqlConnection)verificationContext.Database.GetDbConnection();
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'ParticipantSessions';
            """;
        await using var reader = await command.ExecuteReaderAsync();
        var columns = new List<string>();

        while (await reader.ReadAsync())
        {
            columns.Add(reader.GetString(0));
        }

        Assert.Contains("TokenHash", columns);
        Assert.DoesNotContain(columns, column =>
            column.Contains("Credential", StringComparison.OrdinalIgnoreCase)
            || string.Equals(column, "Token", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Database_enforces_one_session_per_Room_role()
    {
        var room = CreateWaitingRoom();

        await using var dbContext = fixture.CreateDbContext();
        var roomRepository = new RoomRepository(dbContext);
        await roomRepository.AddAsync(room);
        await roomRepository.SaveChangesAsync();
        var store = new ParticipantSessionStore(dbContext);
        await store.AddAsync(CreateSessionRecord(room.Id, Guid.NewGuid(), ParticipantRole.Guest));
        await store.SaveChangesAsync();
        await store.AddAsync(CreateSessionRecord(room.Id, Guid.NewGuid(), ParticipantRole.Guest));

        var exception = await Assert.ThrowsAsync<DbUpdateException>(
            () => store.SaveChangesAsync());
        var postgresException = Assert.IsType<PostgresException>(exception.InnerException);

        Assert.Equal(PostgresErrorCodes.UniqueViolation, postgresException.SqlState);
        Assert.Equal("IX_ParticipantSessions_RoomId_Role", postgresException.ConstraintName);
    }

    [Fact]
    public async Task Join_flow_rolls_back_the_Guest_assignment_when_session_issuance_fails()
    {
        var room = CreateWaitingRoom();
        await SaveRoomAsync(room);

        await using (var dbContext = fixture.CreateDbContext())
        {
            var roomRepository = new RoomRepository(dbContext);
            var flow = new JoinRoomSession(
                new JoinRoom(roomRepository, new FixedTimeProvider(NowUtc.AddMinutes(1))),
                CreateSessionService(new FailingParticipantSessionStore()),
                new RoomSessionTransaction(dbContext));

            await Assert.ThrowsAsync<SessionStoreFailureException>(
                () => flow.ExecuteAsync(room.Id));
        }

        await using var verificationContext = fixture.CreateDbContext();
        var persisted = await new RoomRepository(verificationContext).GetByIdAsync(room.Id);

        Assert.NotNull(persisted);
        Assert.Null(persisted.GuestId);
        Assert.Equal(RoomStatus.WaitingForGuest, persisted.Status);
        Assert.Empty(verificationContext.ParticipantSessions.Where(session => session.RoomId == room.Id));
    }

    [Fact]
    public async Task Create_flow_rolls_back_the_Room_when_Host_session_issuance_fails()
    {
        Guid createdRoomId;

        await using (var dbContext = fixture.CreateDbContext())
        {
            var roomRepository = new CapturingRoomRepository(new RoomRepository(dbContext));
            var flow = new CreateRoomSession(
                new CreateRoom(roomRepository, new FixedTimeProvider(NowUtc)),
                CreateSessionService(new FailingParticipantSessionStore()),
                new RoomSessionTransaction(dbContext));

            await Assert.ThrowsAsync<SessionStoreFailureException>(
                () => flow.ExecuteAsync(NowUtc.AddHours(2)));
            createdRoomId = Assert.IsType<Room>(roomRepository.AddedRoom).Id;
        }

        await using var verificationContext = fixture.CreateDbContext();
        var persisted = await new RoomRepository(verificationContext).GetByIdAsync(createdRoomId);

        Assert.Null(persisted);
    }

    [Fact]
    public async Task Two_concurrent_join_flows_produce_one_Guest_and_one_valid_Guest_session()
    {
        var room = CreateWaitingRoom();
        await SaveRoomAsync(room);
        var coordinator = new TwoLoadCoordinator();

        await using var firstContext = fixture.CreateDbContext();
        await using var secondContext = fixture.CreateDbContext();
        var firstFlow = CreateCoordinatedJoinFlow(firstContext, coordinator);
        var secondFlow = CreateCoordinatedJoinFlow(secondContext, coordinator);

        var outcomes = await Task.WhenAll(
            CaptureJoinAsync(() => firstFlow.ExecuteAsync(room.Id)),
            CaptureJoinAsync(() => secondFlow.ExecuteAsync(room.Id)));

        var success = Assert.Single(outcomes, outcome => outcome.Result is not null);
        var failure = Assert.Single(outcomes, outcome => outcome.Exception is not null);
        Assert.IsType<RoomConcurrencyException>(failure.Exception);

        await using var verificationContext = fixture.CreateDbContext();
        var persistedRoom = await new RoomRepository(verificationContext).GetByIdAsync(room.Id);
        var persistedSessions = await verificationContext.ParticipantSessions
            .AsNoTracking()
            .Where(session => session.RoomId == room.Id && session.Role == ParticipantRole.Guest)
            .ToListAsync();

        Assert.NotNull(success.Result);
        Assert.NotNull(persistedRoom);
        Assert.Equal(success.Result.Session.ParticipantId, persistedRoom.GuestId);
        Assert.Single(persistedSessions);
        Assert.Equal(success.Result.Session.ParticipantId, persistedSessions[0].ParticipantId);

        var validator = CreateSessionService(new ParticipantSessionStore(verificationContext));
        var trusted = await validator.ValidateAsync(success.Result.Session.Credential, room.Id);
        Assert.Equal(persistedRoom.GuestId, trusted.ParticipantId);
        Assert.Equal(ParticipantRole.Guest, trusted.Role);
    }

    private JoinRoomSession CreateCoordinatedJoinFlow(
        DuovieDbContext dbContext,
        TwoLoadCoordinator coordinator)
    {
        var roomRepository = new CoordinatedRoomRepository(
            new RoomRepository(dbContext),
            coordinator);

        return new JoinRoomSession(
            new JoinRoom(roomRepository, new FixedTimeProvider(NowUtc.AddMinutes(1))),
            CreateSessionService(new ParticipantSessionStore(dbContext)),
            new RoomSessionTransaction(dbContext));
    }

    private static ParticipantSessionService CreateSessionService(IParticipantSessionStore store)
    {
        return new ParticipantSessionService(
            store,
            new ParticipantSessionOptions(SessionLifetime),
            new FixedTimeProvider(NowUtc));
    }

    private static ParticipantSessionRecord CreateSessionRecord(
        Guid roomId,
        Guid participantId,
        ParticipantRole role)
    {
        return new ParticipantSessionRecord(
            Guid.NewGuid(),
            roomId,
            participantId,
            role,
            RandomNumberGenerator.GetBytes(32),
            NowUtc,
            NowUtc.Add(SessionLifetime));
    }

    private async Task SaveRoomAsync(Room room)
    {
        await using var dbContext = fixture.CreateDbContext();
        var repository = new RoomRepository(dbContext);
        await repository.AddAsync(room);
        await repository.SaveChangesAsync();
    }

    private static Room CreateWaitingRoom()
    {
        return Room.Create(Guid.NewGuid(), Guid.NewGuid(), NowUtc, NowUtc.AddHours(2));
    }

    private static async Task<JoinOutcome> CaptureJoinAsync(Func<Task<JoinRoomSessionResult>> operation)
    {
        try
        {
            return new JoinOutcome(await operation(), null);
        }
        catch (Exception exception)
        {
            return new JoinOutcome(null, exception);
        }
    }

    private sealed record JoinOutcome(JoinRoomSessionResult? Result, Exception? Exception);

    private sealed class TwoLoadCoordinator
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
        TwoLoadCoordinator coordinator) : IRoomRepository
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

    private sealed class CapturingRoomRepository(IRoomRepository inner) : IRoomRepository
    {
        public Room? AddedRoom { get; private set; }

        public Task<Room?> GetByIdAsync(
            Guid roomId,
            CancellationToken cancellationToken = default)
        {
            return inner.GetByIdAsync(roomId, cancellationToken);
        }

        public Task AddAsync(Room room, CancellationToken cancellationToken = default)
        {
            AddedRoom = room;
            return inner.AddAsync(room, cancellationToken);
        }

        public Task SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            return inner.SaveChangesAsync(cancellationToken);
        }
    }

    private sealed class FailingParticipantSessionStore : IParticipantSessionStore
    {
        public Task AddAsync(
            ParticipantSessionRecord session,
            CancellationToken cancellationToken = default)
        {
            throw new SessionStoreFailureException();
        }

        public Task<ParticipantSessionRecord?> GetByTokenHashAsync(
            byte[] tokenHash,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult<ParticipantSessionRecord?>(null);
        }

        public Task SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            return Task.CompletedTask;
        }
    }

    private sealed class SessionStoreFailureException : Exception;

    private sealed class FixedTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow()
        {
            return utcNow;
        }
    }
}
