using Duovie.Domain.Rooms;
using Duovie.Infrastructure.Persistence.Configurations;
using Microsoft.EntityFrameworkCore;

namespace Duovie.Infrastructure.Persistence;

public sealed class DuovieDbContext(DbContextOptions<DuovieDbContext> options) : DbContext(options)
{
    public DbSet<Room> Rooms => Set<Room>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfiguration(new RoomConfiguration());
    }
}
