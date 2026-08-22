using Duovie.Domain.Rooms;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Duovie.Infrastructure.Persistence.Configurations;

public sealed class RoomConfiguration : IEntityTypeConfiguration<Room>
{
    public void Configure(EntityTypeBuilder<Room> builder)
    {
        builder.ToTable("Rooms", tableBuilder =>
        {
            tableBuilder.HasCheckConstraint(
                "CK_Room_ExpirationAfterCreation",
                "\"ExpiresAtUtc\" > \"CreatedAtUtc\"");
            tableBuilder.HasCheckConstraint(
                "CK_Room_DistinctParticipants",
                "\"GuestId\" IS NULL OR \"GuestId\" <> \"HostId\"");
            tableBuilder.HasCheckConstraint(
                "CK_Room_ValidStatus",
                "\"Status\" IN ('WaitingForGuest', 'Ready', 'Closed')");
        });

        builder.HasKey(room => room.Id);

        builder.Property(room => room.Id)
            .ValueGeneratedNever();
        builder.Property(room => room.HostId)
            .IsRequired();
        builder.Property(room => room.GuestId);
        builder.Property(room => room.CreatedAtUtc)
            .IsRequired();
        builder.Property(room => room.ExpiresAtUtc)
            .IsRequired();
        builder.Property(room => room.ClosedAtUtc);
        builder.Property(room => room.Status)
            .HasConversion<string>()
            .HasMaxLength(32)
            .IsRequired();

        builder.Property<uint>("xmin")
            .IsRowVersion();

        builder.Ignore(room => room.ParticipantCount);
    }
}
