using Duovie.Application.Rooms;
using Duovie.Domain.Rooms;
using Duovie.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Duovie.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public class RoomPersistenceTests(PostgreSqlFixture fixture)
{
    private static readonly Guid HostId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid GuestId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid SecondGuestId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly DateTimeOffset CreatedAtUtc = new(2026, 8, 22, 10, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ExpiresAtUtc = CreatedAtUtc.AddHours(2);

    [Fact]
    public async Task Repository_adds_and_loads_a_Room_with_all_fields_intact()
    {
        var room = CreateRoom();

        await using (var writeContext = fixture.CreateDbContext())
        {
            var repository = new RoomRepository(writeContext);
            await repository.AddAsync(room);
            await repository.SaveChangesAsync();
        }

        await using var readContext = fixture.CreateDbContext();
        var loaded = await new RoomRepository(readContext).GetByIdAsync(room.Id);

        Assert.NotNull(loaded);
        Assert.Equal(room.Id, loaded.Id);
        Assert.Equal(HostId, loaded.HostId);
        Assert.Null(loaded.GuestId);
        Assert.Equal(CreatedAtUtc, loaded.CreatedAtUtc);
        Assert.Equal(ExpiresAtUtc, loaded.ExpiresAtUtc);
        Assert.Null(loaded.ClosedAtUtc);
        Assert.Equal(RoomStatus.WaitingForGuest, loaded.Status);
    }

    [Fact]
    public async Task Repository_persists_and_loads_a_ready_Room_with_its_Guest()
    {
        var room = CreateRoom();
        room.AddGuest(GuestId, CreatedAtUtc.AddMinutes(1));

        await SaveRoomAsync(room);

        await using var readContext = fixture.CreateDbContext();
        var loaded = await new RoomRepository(readContext).GetByIdAsync(room.Id);

        Assert.NotNull(loaded);
        Assert.Equal(GuestId, loaded.GuestId);
        Assert.Equal(RoomStatus.Ready, loaded.Status);
    }

    [Fact]
    public async Task Repository_persists_the_first_close_time()
    {
        var room = CreateRoom();
        var firstCloseUtc = CreatedAtUtc.AddMinutes(10);
        room.Close(firstCloseUtc);
        room.Close(firstCloseUtc.AddMinutes(1));

        await SaveRoomAsync(room);

        await using var readContext = fixture.CreateDbContext();
        var loaded = await new RoomRepository(readContext).GetByIdAsync(room.Id);

        Assert.NotNull(loaded);
        Assert.Equal(RoomStatus.Closed, loaded.Status);
        Assert.Equal(firstCloseUtc, loaded.ClosedAtUtc);
    }

    [Fact]
    public async Task Database_rejects_expiration_that_is_not_after_creation()
    {
        await using var dbContext = fixture.CreateDbContext();
        var roomId = Guid.NewGuid();

        var exception = await Assert.ThrowsAsync<PostgresException>(
            () => dbContext.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "Rooms"
                    ("Id", "HostId", "GuestId", "CreatedAtUtc", "ExpiresAtUtc", "ClosedAtUtc", "Status")
                VALUES
                    ({roomId}, {HostId}, NULL, {CreatedAtUtc}, {CreatedAtUtc}, NULL, {"WaitingForGuest"});
                """));

        Assert.Equal(PostgresErrorCodes.CheckViolation, exception.SqlState);
        Assert.Equal("CK_Room_ExpirationAfterCreation", exception.ConstraintName);
    }

    [Fact]
    public async Task Database_rejects_identical_Host_and_Guest()
    {
        await using var dbContext = fixture.CreateDbContext();
        var roomId = Guid.NewGuid();

        var exception = await Assert.ThrowsAsync<PostgresException>(
            () => dbContext.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "Rooms"
                    ("Id", "HostId", "GuestId", "CreatedAtUtc", "ExpiresAtUtc", "ClosedAtUtc", "Status")
                VALUES
                    ({roomId}, {HostId}, {HostId}, {CreatedAtUtc}, {ExpiresAtUtc}, NULL, {"Ready"});
                """));

        Assert.Equal(PostgresErrorCodes.CheckViolation, exception.SqlState);
        Assert.Equal("CK_Room_DistinctParticipants", exception.ConstraintName);
    }

    [Fact]
    public async Task Two_stale_Guest_joins_cannot_both_be_persisted()
    {
        var room = CreateRoom();
        await SaveRoomAsync(room);

        await using var firstContext = fixture.CreateDbContext();
        await using var secondContext = fixture.CreateDbContext();
        var firstRepository = new RoomRepository(firstContext);
        var secondRepository = new RoomRepository(secondContext);
        var firstRoom = await firstRepository.GetByIdAsync(room.Id);
        var secondRoom = await secondRepository.GetByIdAsync(room.Id);

        Assert.NotNull(firstRoom);
        Assert.NotNull(secondRoom);
        firstRoom.AddGuest(GuestId, CreatedAtUtc.AddMinutes(1));
        secondRoom.AddGuest(SecondGuestId, CreatedAtUtc.AddMinutes(1));

        await firstRepository.SaveChangesAsync();
        await Assert.ThrowsAsync<RoomConcurrencyException>(
            () => secondRepository.SaveChangesAsync());

        await using var verificationContext = fixture.CreateDbContext();
        var persisted = await new RoomRepository(verificationContext).GetByIdAsync(room.Id);

        Assert.NotNull(persisted);
        Assert.Equal(GuestId, persisted.GuestId);
        Assert.Equal(RoomStatus.Ready, persisted.Status);
    }

    [Fact]
    public async Task Stale_join_cannot_overwrite_a_concurrent_close()
    {
        var room = CreateRoom();
        await SaveRoomAsync(room);

        await using var joinContext = fixture.CreateDbContext();
        await using var closeContext = fixture.CreateDbContext();
        var joinRepository = new RoomRepository(joinContext);
        var closeRepository = new RoomRepository(closeContext);
        var joiningRoom = await joinRepository.GetByIdAsync(room.Id);
        var closingRoom = await closeRepository.GetByIdAsync(room.Id);

        Assert.NotNull(joiningRoom);
        Assert.NotNull(closingRoom);
        joiningRoom.AddGuest(GuestId, CreatedAtUtc.AddMinutes(1));
        var closedAtUtc = CreatedAtUtc.AddMinutes(1);
        closingRoom.Close(closedAtUtc);

        await closeRepository.SaveChangesAsync();
        await Assert.ThrowsAsync<RoomConcurrencyException>(
            () => joinRepository.SaveChangesAsync());

        await using var verificationContext = fixture.CreateDbContext();
        var persisted = await new RoomRepository(verificationContext).GetByIdAsync(room.Id);

        Assert.NotNull(persisted);
        Assert.Null(persisted.GuestId);
        Assert.Equal(RoomStatus.Closed, persisted.Status);
        Assert.Equal(closedAtUtc, persisted.ClosedAtUtc);
    }

    private async Task SaveRoomAsync(Room room)
    {
        await using var dbContext = fixture.CreateDbContext();
        var repository = new RoomRepository(dbContext);
        await repository.AddAsync(room);
        await repository.SaveChangesAsync();
    }

    private static Room CreateRoom()
    {
        return Room.Create(Guid.NewGuid(), HostId, CreatedAtUtc, ExpiresAtUtc);
    }
}
