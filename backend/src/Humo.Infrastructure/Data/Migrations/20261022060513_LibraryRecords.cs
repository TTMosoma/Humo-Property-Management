using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class LibraryRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "RecordId",
                table: "LibraryDocuments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RecordKind",
                table: "LibraryDocuments",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RecordId",
                table: "LibraryDocuments");

            migrationBuilder.DropColumn(
                name: "RecordKind",
                table: "LibraryDocuments");
        }
    }
}
