using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class MessageUsage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MessageUsage",
                columns: table => new
                {
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Period = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    Channel = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Units = table.Column<int>(type: "integer", nullable: false),
                    Messages = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessageUsage", x => new { x.OrganisationId, x.Period, x.Channel });
                    table.ForeignKey(
                        name: "FK_MessageUsage_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MessageUsage");
        }
    }
}
