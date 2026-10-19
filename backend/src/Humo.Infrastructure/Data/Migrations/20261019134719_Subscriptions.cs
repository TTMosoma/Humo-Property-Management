using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class Subscriptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Agreements",
                columns: table => new
                {
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Document = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Agreements", x => x.OrganisationId);
                    table.ForeignKey(
                        name: "FK_Agreements_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Subscriptions",
                columns: table => new
                {
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Seats = table.Column<int>(type: "integer", nullable: false),
                    Overrides = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Subscriptions", x => x.OrganisationId);
                    table.ForeignKey(
                        name: "FK_Subscriptions_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UpgradeRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    AddOn = table.Column<string>(type: "text", nullable: true),
                    Package = table.Column<string>(type: "text", nullable: true),
                    Feature = table.Column<string>(type: "text", nullable: true),
                    Note = table.Column<string>(type: "text", nullable: true),
                    Source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    RequestedBy = table.Column<string>(type: "text", nullable: false),
                    RequestedById = table.Column<Guid>(type: "uuid", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UpgradeRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UpgradeRequests_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UpgradeRequests_OrganisationId",
                table: "UpgradeRequests",
                column: "OrganisationId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Agreements");

            migrationBuilder.DropTable(
                name: "Subscriptions");

            migrationBuilder.DropTable(
                name: "UpgradeRequests");
        }
    }
}
