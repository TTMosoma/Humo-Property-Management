# Workflow test results

All workflows ran in the built-in browser against the dev server (`ng serve`, port 4310) on 10 October 2026, using the frontend simulation. "Pass" means the simulation behaved as expected; no backend exists.

**Status key:** **Pass** · **Pass with findings** · **Partial** (part executed, part blocked) · **Fail** · **Blocked**

Finding IDs (F-xx) are listed with severity in [current-state-summary.md](current-state-summary.md).

---

## W1 — Onboard an agency and invite its first administrator

| | |
|---|---|
| **Persona** | Nomsa Khoza, working as Humo System Administrator |
| **Preconditions** | Platform › Customers reachable (`Platform.Customers.View`). |
| **Steps** | 1. Platform › Customers › *Onboard customer*: "Audit Test Property Managers (Pty) Ltd", known as "Audit Test PM", Pretoria, Gauteng, Humo Professional, account manager Dumisani. 2. On the customer page, *Invite their administrator*: Palesa Audit, palesa@audit-test.example. 3. Step-up (simulated passkey). 4. Platform › Users & impersonation, search "Palesa". |
| **Expected** | The organisation exists in onboarding on a trial. The administrator is invited as Agency Administrator and listed. |
| **Actual** | As expected: customer page `/platform/customers/audit-test-pm` (Onboarding, Trial, 0 schemes). The toast confirmed the invitation. Palesa is listed as Agency Administrator of Audit Test PM. |
| **Status** | **Pass with findings** |

**Findings:**
- **F-21:** the onboarding form says *"Invite their first administrator from Users & impersonation"*, but the action is on the customer page.
- **F-22:** the first-administrator invite lets Humo staff choose any customer role (Owner, Tenant, Trustee…), not only Agency Administrator.
- **F-23:** a brand-new customer immediately shows **Critical** health (34/100) from zero usage. This is already listed as a blind spot in `docs/09`.
- **F-24:** the breadcrumb shows the raw id `audit-test-pm` instead of the customer's name.

---

## W2 — Create a scheme and a unit

| | |
|---|---|
| **Persona** | Thandeka Mokoena, Agency Administrator (Acacia) |
| **Steps** | 1. Schemes › *Add a scheme*: "Audit Gardens", code AG, Lynnwood, Pretoria, Gauteng. 2. On Units, *Add a unit*: unit 1, 2-bed apartment, 78 m², quota 5.5%, levy R 1 850, "The owner". |
| **Expected** | The scheme is created (onboarding) and the unit with levy account AG-001. |
| **Actual** | The scheme was created and opened at `/schemes/audit-gardens/units`. The unit row shows `AG Unit 1 · 78 m² · Owner-occupied · R 1 850.00 · R 0.00 · Up to date`. |
| **Status** | **Pass with findings** |

**Findings:**
- **F-14:** the participation quota ("Sets its share of the levy") and the monthly levy are entered separately, with no derivation or check, so they can contradict each other.
- **F-25:** the unit is labelled "Owner-occupied" before any owner exists.
- **Not checked:** whether Humo Property Management stops two schemes from using the same code.

---

## W3 — Add an owner and link them to the unit

| | |
|---|---|
| **Persona** | Thandeka |
| **Steps** | People › *Add an owner, tenant or trustee*: Lindiwe Audit, mobile, email, role Owner of a unit, scheme Audit Gardens, unit 1. Then open the unit. |
| **Expected** | One person record. The unit shows the owner, and the account holder is the owner. |
| **Actual** | Person `/people/per-1617` shows Owner · Audit Gardens Unit 1 AG-001. The unit page shows Lindiwe as OWNER. The relationship chain reads Scheme → Unit → Owner → Account. |
| **Status** | **Pass with findings** |

**Findings:**
- **F-26:** the relationship's start date shows **09 Oct 2026** while the browser's local date was 10 Oct (just after midnight, UTC+2). A date default is computed in UTC: 17 `toISOString().slice(0, 10)` uses exist.
- **F-27:** the person page shows *"Portal access: Not invited yet"* with no action to invite them.
- **F-28:** the same form offers *"Trustee of a scheme"*. That creates board membership outside the trustee board's rules (elected or co-opted, with a resolution).

---

## W4 — Rename the scheme and check other screens

| | |
|---|---|
| **Persona** | Thandeka |
| **Steps** | Scheme overview › *Edit* › rename to "Audit Gardens Estate" › save. Re-open the person page. |
| **Expected** | The new name everywhere the scheme is shown. |
| **Actual** | The overview title and the person's relationship both show "Audit Gardens Estate". |
| **Status** | **Pass with findings** |

**Findings:**
- **F-12:** the scheme was created minutes earlier and is still *onboarding*, yet the overview lists the AGM as **116 days overdue**, and audited statements and the CSOS return as **102 days overdue**.
  - Six `compliance-due` Tasks were created at once (seen in the simulated data), all **unassigned** because the scheme has no portfolio manager yet.
  - Compliance ignores when the scheme came onto Humo Property Management, and its onboarding status.

---

## W5 — Log a maintenance request

| | |
|---|---|
| **Persona** | Thandeka |
| **Steps** | Maintenance › Log request: Audit Gardens Estate, in a unit, unit 1 (search), Water & leaks, Bathroom, title and description, reported by "Me". |
| **Expected** | A job at *New — needs triage*, with the next step shown. |
| **Actual** | Job **MR-1240** was created: "Plumbing · Normal priority · New — needs triage", unassigned, with a 13-stage tracker (Reported → Quotes → Approval → Order → Booked → Working → Done → Verified → Invoice → Paid → Closed). Next step: triage. *"No suppliers for Plumbing serve this scheme yet."* |
| **Status** | **Partial** |

**Why partial:**
- The lifecycle past triage needs a supplier serving the new scheme, which would mean more set-up. It wasn't re-run in this audit (Checkpoint 4's doc reports it was tested then).

**Findings:**
- **F-29:** a job logged by staff on a scheme without a portfolio manager is unassigned, with nothing to flag it.
- A water leak defaults to *Normal* priority. That's a product decision rather than a defect.
- **Withdrawn:** an apparent "unit search returns nothing" was caused by my scripted input. With real typing the search works.

---

## W6 — Account balance against the statement

| | |
|---|---|
| **Persona** | Thandeka |
| **Steps** | Open KC-042's account, then its October 2026 statement. |
| **Expected** | Statement closing balance = account balance. Payment details are the scheme's trust account. |
| **Actual** | Account balance **R 4 812.50** (Oct charges R 4 812.50, brought forward R 0.00). Statement opening R 0.00, closing **R 4 812.50**, "Please pay by 07 Oct 2026". How to pay: First National Bank · Account 62 052 269 861 · Branch 250 655, reference KC-042. The letterhead is Acacia Managing Agents' details. |
| **Status** | **Pass** |

**Notes:**
- The history behind the balance is *generated* from the seeded balance (`mock-db.ts` `ledger()`); see F-04.
- An unallocated receipt matching the levy (R 3 480.00, "ANELE M") is shown as a suggestion. Allocation wasn't executed in this audit.

---

## W7 — Role and scope visibility

| Step | Persona | Expected | Actual | Result |
|---|---|---|---|---|
| Open `/schemes/kloof-forest/overview` (not one of Johan's 8 assigned schemes) | Johan, Portfolio Manager | Not found, or read-only by policy | **Full overview shown**: units, arrears, jobs | **Finding F-07** |
| Open `/finance/billing` | Anele, Owner | No access | "You don't have access to this page — As Owner…" | Pass |
| Open `/my/statements/2026-10` | Anele | Her own statement | Shown | Pass |

**F-07:**
- `scheme.resolver.ts` deliberately lets any `portfolio-manager` open every scheme in the agency, by checking the role name. That contradicts the access guard's principle that "roles never appear here".
- Because commands aren't scope-checked (F-02), the code suggests the same Portfolio Manager could also *change* records in that scheme. **This is inferred from code, not executed.**

---

## W8 — Entitlements, and impersonation in Observe mode

| | |
|---|---|
| **Persona** | Terry Mosoma (System Administrator with the `System.Impersonate` grant) observing as Annette Visser, Agency Administrator of Fynbos (Humo Essentials) |
| **Steps** | 1. Platform › Users & impersonation › Annette › *View as…* › Observe › reason "Customer support investigation" › acknowledge › start. 2. Open `/finance/budgets`. 3. Open `/settings/agency`. 4. Exit impersonation. |
| **Expected** | A banner shows the impersonation. Budgets is blocked by plan. Nothing can be edited. |
| **Actual** | Banner: "Impersonation mode · Viewing as Annette Visser · Agency Administrator · Fynbos · Observe — read-only · you are Terry Mosoma". Budgets: *"Budgets — not included in your current plan"*, and the nav has no Budgets. Agency settings: no edit buttons. Exiting returned to Platform › Users. |
| **Status** | **Pass** |

**Notes:**
- **F-30:** the plan message says *"Your agency administrator can ask Humo…"* although Annette *is* the administrator. Observe mode filters her permissions, which changes the wording (minor).
- **Not executed:** a server-side refusal of a write in Observe mode. The gateway code refuses it (`mock-gateway.ts` `authorise`), but the UI hid every write, so there was nothing to try.

---

## Workflows not executed in this audit

| Workflow | Why | What evidence exists |
|---|---|---|
| Billing run: calculate, exceptions, approval, post, statements | Time; heavy set-up | Checkpoint 6 doc (`docs/11`) reports browser testing |
| Receipt allocation and its effect on balance and statement | Not run | Code: `mock-db.ts` `allocate()` → `rebalance()` |
| Credit control letters, letter of demand approval | Not run | `docs/11` |
| Meeting lifecycle, resolution, actions | Not run | `docs/10` |
| Payables batch release (step-up) | Not run | Checkpoint 4 and 6 docs |
| Concurrency (409) between two users | The simulation is per browser | Code: `MockGateway.command` version check |
| Phone layout and field mode | Not run | `docs/13` |
