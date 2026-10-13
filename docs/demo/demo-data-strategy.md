# Demo data strategy

**Purpose:** one demo baseline that the Angular prototype uses today and the .NET backend will seed from later. The same scenario, every time, whoever presents it.

**Related:**
- [demo-readiness-matrix.md](demo-readiness-matrix.md)
- [demo-walkthrough.md](demo-walkthrough.md)
- [demo-limitations.md](demo-limitations.md)
- [../09-simulation.md](../09-simulation.md): how the simulation stores data in the browser.
- [../19-demo-deployment.md](../19-demo-deployment.md): pm-demo.humo.co.za.

## 1. Where the demo data lives

| Layer | Where | What |
|---|---|---|
| **Canonical fixtures** | `/demo-data/` (repository root), JSON | Commercial catalogue and settings, the named customers' agreements, storage measurements, invoices, payments, and Humo account-manager assignments. Read by the frontend today and by the .NET seeder later. |
| **Manifest** | `/demo-data/manifest.json` | Dataset id and version, schema version, baseline date, scenarios, each file's entities, keys and dependencies, the insertion order, and the areas not yet migrated. |
| **Generated seeds** (not yet migrated) | `frontend/humo-web/src/app/mock/fixtures/*.ts`, `mock/db/seed-*.ts` | Personas, organisations, schemes, units, owners, ledgers, maintenance, governance, documents and notifications. Deterministic: seeded random (`mock/db/random.ts`) with dates relative to today. |
| **Typed loader** | `mock/fixtures/demo-data.ts` | Imports the JSON once, typed with the domain models. Stores copy what they need; the fixtures never change at runtime. |

**Why JSON at the root:**
- It isn't frontend code: the backend reads the same files.
- It's plain data that can be diffed and reviewed in a pull request.

**Why not move everything now:**
- The generated seeds already work, are deterministic and are covered by tests.
- Moving each area is done with the backend slice that persists it, so the fixture shape matches the real model rather than guessing it.
- The manifest lists what remains (`notYetMigrated`).

**All data is synthetic:**
- No real customer records, personal information, documents, credentials or financial data.
- `.example` email domains.
- Simulated bank references (`SIM-…`).
- See [demo-limitations.md](demo-limitations.md) about the Tshikrand name.

## 2. Identifiers

- **Stable, readable ids:**
  - `acacia`, `am-mashoto`, `inv-acacia-202610`, `ao-acacia-whatsapp`;
  - generated customers are `cust-001` to `cust-180`.
- **References between files use those ids.** They are never array positions.
- **Generated records are deterministic.** The same seed key always produces the same record, e.g. `seeded('billing-cust-014')`.

## 3. Dates

- **Fixture dates are absolute**, e.g. the WhatsApp add-on from **2026-11-01**. The manifest's `baselineDate` (2026-10-12) is the "today" the fixtures were written for.
- **Generated seeds are relative to today**, so the operational demo always looks current.
- **When the baseline date has passed:**
  - scheduled fixture changes appear as already in force;
  - the integrity spec still checks totals against `baselineDate`.
- **Moving the baseline:** update `baselineDate` and the dated fixture records together, and bump the dataset `version`.

## 4. Resetting the frontend demo

**From the demo:** *Prototype* (bottom right) › *Reset simulation…* › *Reset everything*.
- It clears every `humo.sim.*` snapshot and the simulated session (`simulationStorage.reset()`), then reloads.
- Every store re-seeds from the canonical fixtures and the deterministic seeds.
- The result doesn't depend on what was clicked before, or in what order. The `demo reset` test proves it: it changes data, resets, and compares with the baseline.

**Other ways to reset:**
- **For everyone:** when a data-model change makes old saved data incompatible, bump `SCHEMA` in `mock/simulation/simulation-storage.ts`. Every visitor's browser re-seeds on the next load.
- **For one browser:** a private window starts from the baseline.

## 5. Automated checks

`mock/fixtures/demo-data.spec.ts` runs with `npm test`. It checks that:
- **The catalogue:**
  - sells only packages and features the app knows;
  - has every code-known add-on;
  - doesn't give an awaiting price an amount;
  - doesn't invent base-package prices.
- **Account managers:** the designated one, every assignment and every customer's manager are active Humo staff with the Account Manager role.
- **Agreements:**
  - each belongs to a customer;
  - each references catalogue items and real people;
  - each charges exactly the customer's recorded contract value;
  - each has a storage measurement.
- **Invoices and payments:**
  - ids, references and provider references are unique;
  - each invoice adds up (lines, subtotal, tax, total) and matches the agreement for its period;
  - *paid* only with verified payments covering it;
  - every payment is simulated.
- **Payment status:** a customer shown as overdue has an overdue invoice, and the other way round.
- **Board figures:** the book of business still adds up (184 customers, R1 840 000 MRR).
- **Maintenance:** jobs reference real schemes, units (in the same scheme) and suppliers.
- **Ledgers:** owner balances reconcile with their ledgers.

## 6. The future .NET seeder

**Shape:**
- A dedicated `Humo.DemoSeeder` console or hosted command. It is not part of application start-up.
- It reads `/demo-data/manifest.json`, then each file in `insertOrder`.

**Mapping:**

| Fixture | Backend (proposed) |
|---|---|
| `commercial/catalogue.json` | `CommercialPackageTerms`, `AddOn`, `AddOnTerms` (one row per version) |
| `commercial/settings.json` | `CommercialSettings` (single row, versioned) |
| `platform/account-managers.json` | `Organisation.AccountManagerId` (FK to the staff identity) |
| `commercial/agreements.json` | `Agreement`, `AgreementPackageLine`, `AgreementAddOnLine`, `AgreementAdjustment`, `StorageException`, `AgreementEvent` |
| `commercial/storage-usage.json` | `StorageMeasurement` (source `demo`) |
| `commercial/invoices.json` | `Invoice`, `InvoiceLine` |
| `commercial/payments.json` | `Payment` (`Simulated = true`), plus the processed notification ids |

**Order:** identities → organisations → account-manager assignments → settings → catalogue → agreements → storage → invoices → payments.
- Each step depends only on earlier ones.
- The TypeScript seeds not yet migrated move into fixtures before their backend slice seeds them.

**IDs:**
- **Recommended:** keep the fixture id as a unique `ExternalKey` column, and let the database assign its own primary keys. The seeder maps external keys to primary keys while inserting, so references resolve.
- **Alternative:** deterministic GUIDs (UUID v5 from `dataset + id`), if the backend uses client-assigned GUIDs.

**Existing records:**
- **Idempotent upsert (default):** match on `ExternalKey`. Insert what's missing; update what differs; leave other records alone.
- **Destructive reset (`--reset`):** delete every record carrying the demo dataset's tag, then seed again. Only demo-tagged rows are touched.

**Safety:**
- It refuses unless the environment is explicitly `Demo` or `Development`, and it **always refuses `Production`**.
- `--reset` also needs `--confirm humo-pm-demo`, typed by the operator.
- It writes a seed-run record: dataset version, schema version, who ran it, and when.

**Versions:**
- **`version`** (dataset) changes when fixture content changes.
- **`schemaVersion`** changes when the fixture shape changes.
- The seeder refuses a `schemaVersion` it doesn't know. A migration step converts older fixtures.

**New features:**
1. Add the entity's fixture file.
2. Add it to the manifest: `files`, `insertOrder`, and `dependsOn`.
3. Add its mapping to the seeder and its checks to the integrity spec.

**What not to build yet:** a generic seeding framework. Build the fixture contract now and connect it to the persistence model slice by slice.

## 7. Keeping demo data current: the checklist

**For every feature change, answer these in the pull request:**
1. **Does the feature need demo data?** If it shows nothing in the demo, add fixtures (or deterministic seeds) so it can be demonstrated.
2. **Are existing fixture relationships still valid?** Run `npm test`: the integrity spec fails on broken references and totals that don't reconcile.
3. **Does the [demo walkthrough](demo-walkthrough.md) need updating?** New screens, renamed buttons, changed personas.
4. **Does the [demo-readiness matrix](demo-readiness-matrix.md) need updating?** Is the area demonstrable, simulated, or not built?
5. **Do reset and the baseline tests pass?** Reset in the browser, then check the change survives a reset correctly.
6. **Does any UI claim something works when it's only simulated?** Simulated payments, sends, measurements and enforcement must say so on screen, and be listed in the [production readiness register](../18-production-readiness-register.md).

**When a fixture's content changes:** bump `version` in the manifest. When its shape changes, bump `schemaVersion` and the frontend `SCHEMA`.
