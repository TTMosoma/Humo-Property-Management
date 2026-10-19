using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class UnitsAndPeople : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "People",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LastName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                    Initials = table.Column<string>(type: "text", nullable: false),
                    Email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    Phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    PreferredChannel = table.Column<string>(type: "text", nullable: false),
                    PostalAddress = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_People", x => x.Id);
                    table.ForeignKey(
                        name: "FK_People_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Units",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(6)", maxLength: 6, nullable: false),
                    AccountNo = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    Block = table.Column<string>(type: "text", nullable: true),
                    Floor = table.Column<int>(type: "integer", nullable: true),
                    Description = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SizeM2 = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    ParticipationQuota = table.Column<decimal>(type: "numeric(9,6)", precision: 9, scale: 6, nullable: false),
                    MonthlyLevy = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Occupancy = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ParkingBays = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Units", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Units_Schemes_SchemeId",
                        column: x => x.SchemeId,
                        principalTable: "Schemes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LevyAccounts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UnitId = table.Column<Guid>(type: "uuid", nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountNo = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    HolderPersonId = table.Column<Guid>(type: "uuid", nullable: true),
                    Balance = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DebitOrder = table.Column<bool>(type: "boolean", nullable: false),
                    StatementBy = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LevyAccounts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LevyAccounts_People_HolderPersonId",
                        column: x => x.HolderPersonId,
                        principalTable: "People",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_LevyAccounts_Units_UnitId",
                        column: x => x.UnitId,
                        principalTable: "Units",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Relationships",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PersonId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    UnitId = table.Column<Guid>(type: "uuid", nullable: true),
                    Portfolio = table.Column<string>(type: "text", nullable: true),
                    Since = table.Column<DateOnly>(type: "date", nullable: false),
                    Until = table.Column<DateOnly>(type: "date", nullable: true),
                    AppointmentHow = table.Column<string>(type: "text", nullable: true),
                    ResolutionRef = table.Column<string>(type: "text", nullable: true),
                    EndReason = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Relationships", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Relationships_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Relationships_Schemes_SchemeId",
                        column: x => x.SchemeId,
                        principalTable: "Schemes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Relationships_Units_UnitId",
                        column: x => x.UnitId,
                        principalTable: "Units",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_LevyAccounts_HolderPersonId",
                table: "LevyAccounts",
                column: "HolderPersonId");

            migrationBuilder.CreateIndex(
                name: "IX_LevyAccounts_UnitId",
                table: "LevyAccounts",
                column: "UnitId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_People_OrganisationId",
                table: "People",
                column: "OrganisationId");

            migrationBuilder.CreateIndex(
                name: "IX_Relationships_PersonId",
                table: "Relationships",
                column: "PersonId");

            migrationBuilder.CreateIndex(
                name: "IX_Relationships_SchemeId_Type",
                table: "Relationships",
                columns: new[] { "SchemeId", "Type" });

            migrationBuilder.CreateIndex(
                name: "IX_Relationships_UnitId",
                table: "Relationships",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_Units_SchemeId_Number",
                table: "Units",
                columns: new[] { "SchemeId", "Number" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LevyAccounts");

            migrationBuilder.DropTable(
                name: "Relationships");

            migrationBuilder.DropTable(
                name: "People");

            migrationBuilder.DropTable(
                name: "Units");
        }
    }
}
