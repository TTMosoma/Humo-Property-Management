using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class SoleAuthority : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "HeldBy",
                table: "WorkItems",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "HeldById",
                table: "WorkItems",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "HeldPermissionId",
                table: "WorkItems",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "HeldUntil",
                table: "WorkItems",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "TrusteePermissions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    FileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Summary = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    GrantedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Until = table.Column<DateOnly>(type: "date", nullable: false),
                    AddedById = table.Column<Guid>(type: "uuid", nullable: false),
                    AddedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    AddedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    WithdrawnAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    WithdrawnBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    WithdrawnReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrusteePermissions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TrusteePermissions_SchemeId",
                table: "TrusteePermissions",
                column: "SchemeId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TrusteePermissions");

            migrationBuilder.DropColumn(
                name: "HeldBy",
                table: "WorkItems");

            migrationBuilder.DropColumn(
                name: "HeldById",
                table: "WorkItems");

            migrationBuilder.DropColumn(
                name: "HeldPermissionId",
                table: "WorkItems");

            migrationBuilder.DropColumn(
                name: "HeldUntil",
                table: "WorkItems");
        }
    }
}
