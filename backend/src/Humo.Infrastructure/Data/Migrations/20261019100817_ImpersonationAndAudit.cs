using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class ImpersonationAndAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ActingAsName",
                table: "AuditLog",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ImpersonationMode",
                table: "AuditLog",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ImpersonationNote",
                table: "AuditLog",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ImpersonationReason",
                table: "AuditLog",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SchemeId",
                table: "AuditLog",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ImpersonationSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    TargetId = table.Column<Guid>(type: "uuid", nullable: false),
                    TargetAssignmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Mode = table.Column<string>(type: "text", nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    Ticket = table.Column<string>(type: "text", nullable: true),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    EndedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImpersonationSessions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ImpersonationSessions_ActorId",
                table: "ImpersonationSessions",
                column: "ActorId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ImpersonationSessions");

            migrationBuilder.DropColumn(
                name: "ActingAsName",
                table: "AuditLog");

            migrationBuilder.DropColumn(
                name: "ImpersonationMode",
                table: "AuditLog");

            migrationBuilder.DropColumn(
                name: "ImpersonationNote",
                table: "AuditLog");

            migrationBuilder.DropColumn(
                name: "ImpersonationReason",
                table: "AuditLog");

            migrationBuilder.DropColumn(
                name: "SchemeId",
                table: "AuditLog");
        }
    }
}
