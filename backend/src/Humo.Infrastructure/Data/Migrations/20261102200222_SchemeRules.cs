using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class SchemeRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RuleBooks",
                columns: table => new
                {
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Json = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RuleBooks", x => x.SchemeId);
                    table.ForeignKey(
                        name: "FK_RuleBooks_Schemes_SchemeId",
                        column: x => x.SchemeId,
                        principalTable: "Schemes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SchemeRules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Number = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false),
                    Category = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Versions = table.Column<string>(type: "text", nullable: false),
                    RepealedAt = table.Column<DateOnly>(type: "date", nullable: true),
                    RepealedBy = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SchemeRules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SchemeRules_Schemes_SchemeId",
                        column: x => x.SchemeId,
                        principalTable: "Schemes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Breaches",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Ref = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    RuleId = table.Column<Guid>(type: "uuid", nullable: false),
                    UnitId = table.Column<Guid>(type: "uuid", nullable: false),
                    PersonId = table.Column<Guid>(type: "uuid", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    OccurredAt = table.Column<DateOnly>(type: "date", nullable: false),
                    ReportedBy = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    RemedyBy = table.Column<DateOnly>(type: "date", nullable: true),
                    Events = table.Column<string>(type: "text", nullable: false),
                    AssigneeId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Breaches", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Breaches_SchemeRules_RuleId",
                        column: x => x.RuleId,
                        principalTable: "SchemeRules",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Breaches_Schemes_SchemeId",
                        column: x => x.SchemeId,
                        principalTable: "Schemes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Breaches_OrganisationId_Number",
                table: "Breaches",
                columns: new[] { "OrganisationId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Breaches_RuleId",
                table: "Breaches",
                column: "RuleId");

            migrationBuilder.CreateIndex(
                name: "IX_Breaches_SchemeId",
                table: "Breaches",
                column: "SchemeId");

            migrationBuilder.CreateIndex(
                name: "IX_SchemeRules_SchemeId",
                table: "SchemeRules",
                column: "SchemeId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Breaches");

            migrationBuilder.DropTable(
                name: "RuleBooks");

            migrationBuilder.DropTable(
                name: "SchemeRules");
        }
    }
}
