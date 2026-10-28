using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class Payables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AccountHolder",
                table: "Suppliers",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "AccountNumber",
                table: "Suppliers",
                type: "character varying(12)",
                maxLength: 12,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "AccountType",
                table: "Suppliers",
                type: "character varying(12)",
                maxLength: 12,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "BankChangedAt",
                table: "Suppliers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankChangedBy",
                table: "Suppliers",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BankChangedById",
                table: "Suppliers",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankName",
                table: "Suppliers",
                type: "character varying(60)",
                maxLength: 60,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "BankVerifiedAt",
                table: "Suppliers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankVerifiedBy",
                table: "Suppliers",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BankWorkItemId",
                table: "Suppliers",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BranchCode",
                table: "Suppliers",
                type: "character varying(6)",
                maxLength: 6,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "PaymentBatches",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Ref = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Total = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Payees = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    ApprovalWorkItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReleasedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ReleasedBy = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    CancelledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CancelledBy = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    CancelReason = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentBatches", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PaymentBatches_Schemes_SchemeId",
                        column: x => x.SchemeId,
                        principalTable: "Schemes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentBatches_OrganisationId_Ref",
                table: "PaymentBatches",
                columns: new[] { "OrganisationId", "Ref" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentBatches_SchemeId_Status",
                table: "PaymentBatches",
                columns: new[] { "SchemeId", "Status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PaymentBatches");

            migrationBuilder.DropColumn(
                name: "AccountHolder",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "AccountNumber",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "AccountType",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "BankChangedAt",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "BankChangedBy",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "BankChangedById",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "BankName",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "BankVerifiedAt",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "BankVerifiedBy",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "BankWorkItemId",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "BranchCode",
                table: "Suppliers");
        }
    }
}
