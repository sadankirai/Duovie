using Microsoft.EntityFrameworkCore;

namespace Duovie.Infrastructure.Persistence;

public sealed class DuovieDbContext(DbContextOptions<DuovieDbContext> options) : DbContext(options)
{
}
