using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Humo.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class StatementsFollowTheOwner : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // D35: a statement belongs to whoever owned the unit that month. One addressed to someone who didn't own it at
            // any point that month (issued to a buyer for the seller's month) stays on record, marked replaced.
            migrationBuilder.Sql("""
                UPDATE "IssuedStatements" i
                SET "ReplacedAt" = now(), "ReplacedBy" = 'Humo Property Management (addressed to someone who didn''t own the unit that month)'
                WHERE i."ReplacedAt" IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM "Relationships" r JOIN "LevyAccounts" a ON a."UnitId" = r."UnitId"
                    WHERE a."Id" = i."AccountId" AND r."Type" = 'owner'
                      AND r."PersonId"::text = (i."Snapshot"::json -> 'view' -> 'holder' ->> 'id')
                      AND r."Since" <= (to_date(i."Period" || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date
                      AND (r."Until" IS NULL OR r."Until" >= to_date(i."Period" || '-01', 'YYYY-MM-DD')))
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
