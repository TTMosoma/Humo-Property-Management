# 22 · Billing inputs: scope notes (receipts, meter readings, levy model)

**Date:** 12 October 2026.

**Purpose:** three features that make month-end real, scoped so they **can't hold up launch**.
- Each one ships **small (v1)**, **behind a feature flag**, and has a **fallback that already works today**.
- Anything outside the v1 scope goes to the **backlog** at the end of this page, not into the slice being built.

**How these are built:**
1. **This page is the agreement.** A slice is done when its "Done when" list is true, and not before or after.
2. **New ideas raised during a slice go to the backlog (§5).** They're reviewed after the slice ships.
3. **Each slice is time-boxed. If it runs over, scope is cut, not the deadline.**
4. **One PR per slice**, merged and switched on by flag, scheme by scheme.
5. **These are frontend specs on the simulation**, like the rest of the prototype. The backend for billing is slice 2. Launch depends on slice 1 (organisations, people, access), the identity provider (D5) and production builds (P1-2). These features must not draw attention away from that.

| Order | Feature | Flag | Fallback until it's on |
|---|---|---|---|
| 1 | Receipt capture and bank-statement import | `receipt-capture` | Receipts arrive as today; allocation works |
| 2 | Meter readings | `meter-readings` | Missing readings bill as the 3-month estimate, already flagged as an exception |
| 3 | Levy model per scheme | `levy-model` | Levies entered per unit (the default, and what every scheme uses today) |

## 1. Receipt capture and bank-statement import

**Status:** ✅ built 12 Oct 2026 (branch `feature/receipt-capture`), behind `receipt-capture`.
- **Screens:** Finance › Receipts › *Capture receipt* and *Import bank statement* (`/finance/receipts/import`); *Remove* on an unallocated receipt.
- **Code:** `domain/models/bank-statement.ts` (the CSV reading rules); `ReceiptDataSource` (`capture`, `statementMapping`, `previewStatement`, `importStatement`, `imports`, `remove`).
- **Tests:** `receipt-capture.spec.ts`, 10 tests.
- **Extras within scope:** the first time a bank's file is seen, columns are suggested from the header names, and the date format from the first row.

**Who:** people with `Receipts.Allocate` (Agency Administrator, Finance). No new permission.

**In v1:**
- **Capture a receipt by hand** (Finance › Receipts › *Capture receipt*):
  - fields: scheme, date, amount, reference, payer (optional);
  - it goes to the scheme's trust account, unallocated.
- **Import a bank statement as CSV** (*Import bank statement*):
  1. Choose the scheme (its trust account) and the file.
  2. **Map the columns once per trust account**: date, amount (or separate credit and debit columns), reference or description, payer (optional), and the date format. The mapping is remembered for next time.
  3. **Preview before importing:**
     - credits become receipts;
     - debits are ignored and counted;
     - **duplicates are skipped**: same scheme, date, amount and reference as a receipt already there, including in this file;
     - rows that can't be read are listed with the reason.
  4. **Confirm:** the receipts are added unallocated. Remembered payers still auto-match them, as today.
  5. Each import is a **batch** (file name, who, when, counts) and is audited.
- **Remove a mistaken receipt**, only while it's unallocated, with a reason. It's audited.
- **Allocation is unchanged.** Suggested matches, *Remember this payer*, splitting across units and suspense all work as now.

**Rules the API enforces:**
- **Amounts and dates:** the amount must be greater than 0; the date can't be in the future and can't be more than 12 months old.
- **Duplicates:** an exact duplicate of a receipt already there is refused.
- **Mapping:** imports can't proceed without a column mapping.
- **Removal:** an allocated receipt can't be removed. Reverse the allocation first.

**Not in v1 (backlog):**
- live bank feeds;
- OFX, MT940 and PDF statements;
- bank-specific presets;
- cash and cheque deposit slips;
- editing a receipt (remove it and capture it again instead);
- splitting a receipt during import;
- new automatic matching rules.

**Done when:**
- a receipt can be captured;
- a CSV from any bank can be mapped, previewed and imported, with duplicates and debits skipped;
- removal works;
- the flag hides it all;
- tests cover the rules above.

## 2. Meter readings (water)

**Status:** ✅ built 12 Oct 2026 (branch `feature/meter-readings`), behind `meter-readings`.
- **Screens:**
  - Levies & billing › *Meter readings* (`/finance/billing/meters`): scheme, month, read-on date; a grid with the last reading, this reading, consumption and usual use; *Fill from CSV*; *Change rate*.
  - On a run that's Preparing, a link to capture readings when it has water exceptions.
- **Code:** `domain/models/meter.ts`; `MeterDataSource`; `mock/db/meter-store.ts` (seeded with four months of readings); `BillingStore.refreshWater`; new exception kind `unusual-reading`.
- **Rule for schemes not using readings yet:** if no readings are captured for a scheme's month, billing behaves exactly as before (simulated water), so nothing changes until a scheme starts capturing.
- **Tests:** `meter-readings.spec.ts`, 6 tests.

**Who:** `Billing.Run` (Agency Administrator, Finance).

**In v1:**
- **Water rate per scheme:** one flat rate per kilolitre (kl), set by `Billing.Run`. It applies only to schemes that recover water.
- **Capture readings for a month** (Finance › Levies & billing › scheme › *Meter readings*):
  - a grid of units showing the last reading, a box for this reading, and the consumption;
  - **or a CSV upload** (unit number, reading).
- **Checks:**
  - **lower than last month:** refused, because a meter rollover or replacement isn't in v1;
  - **more than 3× the unit's usual consumption:** allowed, but flagged on the billing run as *Unusual reading* for a person to confirm.
- **Billing uses them:** a run prepared for that month charges consumption × the rate.
  - Readings captured while a run is still *Preparing* update that run's water lines and clear the *No meter reading* exceptions.
  - Units still without a reading bill the 3-month estimate, flagged, as today.
- **Corrections after posting:** a journal adjustment, as for any charge.
- Readings are audited (who, when, the value).

**Not in v1 (backlog):**
- tiered or municipal tariffs, and sewerage tied to water;
- electricity and gas;
- meter replacement and rollover;
- photos and OCR;
- owners submitting their own readings;
- smart meters;
- readings for past months that are already posted.

**Done when:**
- readings can be captured by grid or CSV with the checks above;
- a prepared run bills the actual consumption;
- unusual readings are flagged;
- the flag hides it all;
- tests cover the rules.

## 3. Levy model per scheme (D13)

**Who:** setting the method and applying a levy roll needs `Billing.Run`.

**In v1:**
- **A setting per scheme**, *How levies are set*:
  - **Entered per unit** (default): as today. Each unit's levy is edited on the unit.
  - **Derived from the approved budget:** monthly levy = the approved budget's annual **Levies** income × the unit's participation quota (normalised, so the scheme's quotas count as 100%) ÷ 12, rounded to the cent.
- **Levy roll proposal** (budget method):
  - From the scheme's **approved** budget, Humo PM shows each unit's current and proposed levy, the new monthly roll, and the difference against the budget.
  - Nothing changes until someone with `Billing.Run` **applies** it. That needs a reason and is audited.
- **When it takes effect:** from the **next** billing run.
  - Applying is refused while a run is in progress (prepared but not yet posted).
  - The run's existing *Levy changed* exception still asks for each change to be confirmed, so nobody is surprised.
- **Switching back** to *Entered per unit* keeps the current amounts. Nothing is recalculated.

**Not in v1 (backlog):**
- back-dating levies for months already billed (catch-up levies);
- exclusive-use areas and separate quotas;
- more than one levy income line, or lines allocated by different rules;
- rounding policies (e.g. to the nearest rand) and putting the rounding difference on one unit;
- mid-year budget revisions;
- special levies from the budget (they stay configured as today).

**Done when:**
- a scheme can switch method;
- a levy roll can be proposed from an approved budget and applied, from the next run, with an audit entry;
- manual schemes are untouched;
- the flag hides it all;
- tests cover the formula and the rules.

## 4. Order and time boxes

1. Receipts: about 2 days.
2. Meter readings: about 2 days.
3. Levy model: about 1.5 days.

If a slice runs over, the rest of its scope moves to the backlog.

## 5. Backlog (raised, not scheduled)

| Raised | Item | From |
|---|---|---|
| 12 Oct 2026 | Live bank feeds; OFX/MT940/PDF statements; bank presets | §1 |
| 12 Oct 2026 | Cash and cheque deposit slips | §1 |
| 12 Oct 2026 | Tiered tariffs, sewerage, electricity and gas | §2 |
| 12 Oct 2026 | Meter replacement and rollover; photos and OCR; owner self-readings | §2 |
| 12 Oct 2026 | Catch-up levies; exclusive-use quotas; rounding policies; mid-year revisions | §3 |
