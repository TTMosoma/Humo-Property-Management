using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class StatementsAndSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AgencySettings",
                columns: table => new
                {
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    RegistrationNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    VatNumber = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    FfcNumber = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    Address = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    Phone = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    BillingDay = table.Column<int>(type: "integer", nullable: false),
                    DueDay = table.Column<int>(type: "integer", nullable: false),
                    StepDays = table.Column<int>(type: "integer", nullable: false),
                    AgmMonths = table.Column<int>(type: "integer", nullable: false),
                    NotificationsJson = table.Column<string>(type: "text", nullable: true),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AgencySettings", x => x.OrganisationId);
                    table.ForeignKey(
                        name: "FK_AgencySettings_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "DocumentSettings",
                columns: table => new
                {
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    DefaultsJson = table.Column<string>(type: "text", nullable: false),
                    ContactEmail = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    ContactPhone = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    FooterText = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    BrandingJson = table.Column<string>(type: "text", nullable: true),
                    StatementDelivery = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentSettings", x => x.OrganisationId);
                    table.ForeignKey(
                        name: "FK_DocumentSettings_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "IssuedStatements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Period = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    TemplateId = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    TemplateVersion = table.Column<int>(type: "integer", nullable: false),
                    Snapshot = table.Column<string>(type: "text", nullable: false),
                    SnapshotSha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Pdf = table.Column<byte[]>(type: "bytea", nullable: true),
                    PdfSha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    IssuedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    IssuedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    BillingRunId = table.Column<Guid>(type: "uuid", nullable: true),
                    SentBy = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    SentAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IssuedStatements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IssuedStatements_LevyAccounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "LevyAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PersonalPreferences",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Work = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Digest = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    QuietFrom = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: true),
                    QuietTo = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PersonalPreferences", x => x.UserId);
                });

            migrationBuilder.CreateTable(
                name: "TrustAccounts",
                columns: table => new
                {
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Bank = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    AccountName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    AccountNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    BranchCode = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Verified = table.Column<bool>(type: "boolean", nullable: false),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrustAccounts", x => x.SchemeId);
                    table.ForeignKey(
                        name: "FK_TrustAccounts_Schemes_SchemeId",
                        column: x => x.SchemeId,
                        principalTable: "Schemes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_IssuedStatements_AccountId_Period",
                table: "IssuedStatements",
                columns: new[] { "AccountId", "Period" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IssuedStatements_BillingRunId",
                table: "IssuedStatements",
                column: "BillingRunId");

            migrationBuilder.CreateIndex(
                name: "IX_IssuedStatements_SchemeId_Period",
                table: "IssuedStatements",
                columns: new[] { "SchemeId", "Period" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AgencySettings");

            migrationBuilder.DropTable(
                name: "DocumentSettings");

            migrationBuilder.DropTable(
                name: "IssuedStatements");

            migrationBuilder.DropTable(
                name: "PersonalPreferences");

            migrationBuilder.DropTable(
                name: "TrustAccounts");
        }
    }
}
