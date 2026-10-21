using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class SessionsAndTrust : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CodeAttempts",
                table: "SignInLinks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "CodeHash",
                table: "SignInLinks",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "TrustedBrowsers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Label = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrustedBrowsers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "UserSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Method = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Trusted = table.Column<bool>(type: "boolean", nullable: false),
                    Device = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Ip = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastActiveAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    IdleMinutes = table.Column<int>(type: "integer", nullable: false),
                    AbsoluteExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserSessions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TrustedBrowsers_TokenHash",
                table: "TrustedBrowsers",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TrustedBrowsers_UserId",
                table: "TrustedBrowsers",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_UserSessions_UserId",
                table: "UserSessions",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TrustedBrowsers");

            migrationBuilder.DropTable(
                name: "UserSessions");

            migrationBuilder.DropColumn(
                name: "CodeAttempts",
                table: "SignInLinks");

            migrationBuilder.DropColumn(
                name: "CodeHash",
                table: "SignInLinks");
        }
    }
}
