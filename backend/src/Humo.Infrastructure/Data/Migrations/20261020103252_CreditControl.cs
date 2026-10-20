using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class CreditControl : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CollectionCases",
                columns: table => new
                {
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Stage = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Json = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionCases", x => x.AccountId);
                    table.ForeignKey(
                        name: "FK_CollectionCases_LevyAccounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "LevyAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "IssuedLetters",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    StepId = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Channel = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    TemplateId = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    TemplateVersion = table.Column<int>(type: "integer", nullable: false),
                    Snapshot = table.Column<string>(type: "text", nullable: false),
                    SnapshotSha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Pdf = table.Column<byte[]>(type: "bytea", nullable: true),
                    PdfSha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    IssuedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    IssuedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    DeliveredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IssuedLetters", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IssuedLetters_LevyAccounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "LevyAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CollectionCases_SchemeId_Stage",
                table: "CollectionCases",
                columns: new[] { "SchemeId", "Stage" });

            migrationBuilder.CreateIndex(
                name: "IX_IssuedLetters_AccountId",
                table: "IssuedLetters",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_IssuedLetters_StepId",
                table: "IssuedLetters",
                column: "StepId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CollectionCases");

            migrationBuilder.DropTable(
                name: "IssuedLetters");
        }
    }
}
