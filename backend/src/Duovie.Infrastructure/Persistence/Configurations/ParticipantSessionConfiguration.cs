using Duovie.Domain.Rooms;
using Duovie.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Duovie.Infrastructure.Persistence.Configurations;

public sealed class ParticipantSessionConfiguration : IEntityTypeConfiguration<ParticipantSessionEntity>
{
    public void Configure(EntityTypeBuilder<ParticipantSessionEntity> builder)
    {
        builder.ToTable("ParticipantSessions", tableBuilder =>
        {
            tableBuilder.HasCheckConstraint(
                "CK_ParticipantSession_ExpirationAfterIssue",
                "\"ExpiresAtUtc\" > \"IssuedAtUtc\"");
            tableBuilder.HasCheckConstraint(
                "CK_ParticipantSession_TokenHashLength",
                "octet_length(\"TokenHash\") = 32");
            tableBuilder.HasCheckConstraint(
                "CK_ParticipantSession_ValidRole",
                "\"Role\" IN ('Host', 'Guest')");
        });

        builder.HasKey(session => session.Id);

        builder.Property(session => session.Id)
            .ValueGeneratedNever();
        builder.Property(session => session.RoomId)
            .IsRequired();
        builder.Property(session => session.ParticipantId)
            .IsRequired();
        builder.Property(session => session.Role)
            .HasConversion<string>()
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(session => session.TokenHash)
            .IsRequired();
        builder.Property(session => session.IssuedAtUtc)
            .IsRequired();
        builder.Property(session => session.ExpiresAtUtc)
            .IsRequired();

        builder.HasIndex(session => session.TokenHash)
            .IsUnique();
        builder.HasIndex(session => new { session.RoomId, session.Role })
            .IsUnique();
        builder.HasIndex(session => new { session.RoomId, session.ParticipantId })
            .IsUnique();

        builder.HasOne<Room>()
            .WithMany()
            .HasForeignKey(session => session.RoomId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
