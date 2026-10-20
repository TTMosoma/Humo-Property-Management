using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class SentMessages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SentMessages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Ref = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    SchemeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Subject = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Body = table.Column<string>(type: "text", nullable: false),
                    Channels = table.Column<string>(type: "text", nullable: false),
                    AudienceLabel = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    SentBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SendAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    SourceLabel = table.Column<string>(type: "text", nullable: true),
                    SourceRoute = table.Column<string>(type: "text", nullable: true),
                    Skipped = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SentMessages", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Deliveries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SentMessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    PersonId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    UnitLabel = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    Channel = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Address = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    Status = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Error = table.Column<string>(type: "text", nullable: true),
                    Values = table.Column<string>(type: "text", nullable: false),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: true),
                    ProviderMessageId = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Deliveries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Deliveries_SentMessages_SentMessageId",
                        column: x => x.SentMessageId,
                        principalTable: "SentMessages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Deliveries_DocumentId",
                table: "Deliveries",
                column: "DocumentId");

            migrationBuilder.CreateIndex(
                name: "IX_Deliveries_SentMessageId",
                table: "Deliveries",
                column: "SentMessageId");

            migrationBuilder.CreateIndex(
                name: "IX_SentMessages_OrganisationId_Ref",
                table: "SentMessages",
                columns: new[] { "OrganisationId", "Ref" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SentMessages_SchemeId_CreatedAt",
                table: "SentMessages",
                columns: new[] { "SchemeId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Deliveries");

            migrationBuilder.DropTable(
                name: "SentMessages");
        }
    }
}
