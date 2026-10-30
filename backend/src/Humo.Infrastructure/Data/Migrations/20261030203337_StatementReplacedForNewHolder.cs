using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class StatementReplacedForNewHolder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_IssuedStatements_AccountId_Period",
                table: "IssuedStatements");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ReplacedAt",
                table: "IssuedStatements",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReplacedBy",
                table: "IssuedStatements",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_IssuedStatements_AccountId_Period",
                table: "IssuedStatements",
                columns: new[] { "AccountId", "Period" },
                unique: true,
                filter: "\"ReplacedAt\" IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_IssuedStatements_AccountId_Period",
                table: "IssuedStatements");

            migrationBuilder.DropColumn(
                name: "ReplacedAt",
                table: "IssuedStatements");

            migrationBuilder.DropColumn(
                name: "ReplacedBy",
                table: "IssuedStatements");

            migrationBuilder.CreateIndex(
                name: "IX_IssuedStatements_AccountId_Period",
                table: "IssuedStatements",
                columns: new[] { "AccountId", "Period" },
                unique: true);
        }
    }
}
