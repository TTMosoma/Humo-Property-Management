using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class D40AccountCorrections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AccountCorrections",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    LineId = table.Column<Guid>(type: "uuid", nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    FileId = table.Column<Guid>(type: "uuid", nullable: true),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    FromDispute = table.Column<bool>(type: "boolean", nullable: false),
                    PreparedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PreparedById = table.Column<Guid>(type: "uuid", nullable: false),
                    PreparedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    WorkItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    DecidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DecidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountCorrections", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AccountCorrections_AccountId",
                table: "AccountCorrections",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_AccountCorrections_LineId",
                table: "AccountCorrections",
                column: "LineId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AccountCorrections");
        }
    }
}
