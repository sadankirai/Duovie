using Duovie.Domain.Rooms;
using Duovie.Infrastructure.Persistence.Configurations;
using Duovie.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Duovie.Infrastructure.Persistence;

public sealed class DuovieDbContext(DbContextOptions<DuovieDbContext> options) : DbContext(options)
{
    public DbSet<Room> Rooms => Set<Room>();

    public DbSet<ParticipantSessionEntity> ParticipantSessions => Set<ParticipantSessionEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfiguration(new RoomConfiguration());
        modelBuilder.ApplyConfiguration(new ParticipantSessionConfiguration());
    }
}
