using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class RuleBreachWorkItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // D32: breach tasks have their own type, so they can be kept from roles that don't enforce the rules.
            migrationBuilder.Sql("""UPDATE "WorkItems" SET "Type" = 'rule-breach' WHERE "Type" = 'follow-up' AND "SourceId" IN (SELECT "Id" FROM "Breaches")""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""UPDATE "WorkItems" SET "Type" = 'follow-up' WHERE "Type" = 'rule-breach'""");
        }
    }
}
