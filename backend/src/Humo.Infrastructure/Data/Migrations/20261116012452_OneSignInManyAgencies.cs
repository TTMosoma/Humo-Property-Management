using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class OneSignInManyAgencies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "AcceptedAt",
                table: "Memberships",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "Memberships",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PersonId",
                table: "Memberships",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Memberships_PersonId",
                table: "Memberships",
                column: "PersonId");

            // D46: each membership carries that agency's own record of the person. First the record the sign-in already
            // pointed at, where it belongs to that agency; then, for another agency, its record with the same email
            // (only when there's exactly one). Memberships in force before D46 count as accepted.
            migrationBuilder.Sql("""
                UPDATE "Memberships" m SET "PersonId" = p."Id"
                FROM "AspNetUsers" u JOIN "People" p ON p."Id"::text = u."PersonId"
                WHERE m."UserId" = u."Id" AND p."OrganisationId" = m."OrganisationId";
                """);
            migrationBuilder.Sql("""
                UPDATE "Memberships" m SET "PersonId" = (
                    SELECT p."Id" FROM "People" p JOIN "AspNetUsers" u ON u."Id" = m."UserId"
                    WHERE p."OrganisationId" = m."OrganisationId" AND lower(p."Email") = lower(u."Email"))
                WHERE m."PersonId" IS NULL AND (
                    SELECT count(*) FROM "People" p JOIN "AspNetUsers" u ON u."Id" = m."UserId"
                    WHERE p."OrganisationId" = m."OrganisationId" AND lower(p."Email") = lower(u."Email")) = 1;
                """);
            migrationBuilder.Sql("""
                UPDATE "Memberships" m SET "Name" = COALESCE(
                    (SELECT p."DisplayName" FROM "People" p WHERE p."Id" = m."PersonId"),
                    (SELECT u."Name" FROM "AspNetUsers" u WHERE u."Id" = m."UserId"));
                UPDATE "Memberships" SET "AcceptedAt" = "Since" WHERE "Status" <> 'ended';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Memberships_PersonId",
                table: "Memberships");

            migrationBuilder.DropColumn(
                name: "AcceptedAt",
                table: "Memberships");

            migrationBuilder.DropColumn(
                name: "Name",
                table: "Memberships");

            migrationBuilder.DropColumn(
                name: "PersonId",
                table: "Memberships");
        }
    }
}
