using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Duovie.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ParticipantSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TokenHash = table.Column<byte[]>(type: "bytea", nullable: false),
                    IssuedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantSessions", x => x.Id);
                    table.CheckConstraint("CK_ParticipantSession_ExpirationAfterIssue", "\"ExpiresAtUtc\" > \"IssuedAtUtc\"");
                    table.CheckConstraint("CK_ParticipantSession_TokenHashLength", "octet_length(\"TokenHash\") = 32");
                    table.CheckConstraint("CK_ParticipantSession_ValidRole", "\"Role\" IN ('Host', 'Guest')");
                    table.ForeignKey(
                        name: "FK_ParticipantSessions_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantSessions_RoomId_ParticipantId",
                table: "ParticipantSessions",
                columns: new[] { "RoomId", "ParticipantId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantSessions_RoomId_Role",
                table: "ParticipantSessions",
                columns: new[] { "RoomId", "Role" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantSessions_TokenHash",
                table: "ParticipantSessions",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ParticipantSessions");
        }
    }
}
