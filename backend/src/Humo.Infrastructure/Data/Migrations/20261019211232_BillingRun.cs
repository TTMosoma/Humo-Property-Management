using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class BillingRun : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LastReminderOn",
                table: "Invoices",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RemindersSent",
                table: "Invoices",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastReminderOn",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "RemindersSent",
                table: "Invoices");
        }
    }
}
