# 09 — Frontend simulation layer: CRUD, persistence and blind spots

Status: **implemented** (October 2026). Humo Property Management can be used end to end as if the .NET backend existed. Records can be created, edited, archived and restored, and the changes survive a page refresh in that browser. This is **development / simulation only**: none of it is production persistence.

## 1. Architecture

```
Angular UI (features/*)
    ↓  forms: features/*/…-forms.ts → shared FormDrawer
Repository interfaces  (domain/ports — the "XxxDataSource" classes)
    ↓  bound in mock/provide-mock-data.ts   (later: provideHttpData())
Mock repositories      (mock/data-sources/in-memory-*)
    ↓  every command goes through MockGateway: Observe → permission → entitlement → step-up → version (409) → validation (422) → audit
In-memory stores       (mock/db/*, mock/contractor/*)  — the simulated database
    ↓  DEVELOPMENT / SIMULATION ONLY
localStorage           (mock/simulation/simulation-storage.ts, keys humo.sim.*)
```

- **Naming.** The brief calls the interfaces repositories (`SchemeRepository`). In this codebase they're the existing ports (`SchemeDataSource`, `PersonDataSource`…): same role, same rule. Components depend on the abstract class only; the mock is bound in one place. They were not renamed, to avoid churn.
- **No separate feature-service layer.** Multi-step application logic lives server-side (in the mock repositories, later the .NET Application layer). UI orchestration lives in a few core services (`StepUpService`, `RoleSwitcher`, `SignOutService`) and the shared form drawer. A pass-through service per entity would add files without adding rules.
- **No mock data in components.** No feature or core file imports from `mock/`; only `mock/provide-mock-data.ts` connects the two.

## 2. Persistence (dev only)

- **What's saved.** Each store saves a snapshot about 0.4 s after it changes and restores it on start-up:
  - portfolio: schemes, units, people, relationships, accounts, receipts, notes, work items;
  - maintenance: suppliers, jobs, invoices, batches;
  - access: identities, credentials, audit log;
  - platform: subscriptions, upgrade requests;
  - commercial: catalogue, agreements, storage measurements, invoices, payments (seeded from `/demo-data/`, see [demo/demo-data-strategy.md](demo/demo-data-strategy.md));
  - organisations;
  - Humo Contractor.
- **Versioned snapshots.** If a store's shape changes, bump `SCHEMA` in `simulation-storage.ts`: old snapshots are then ignored and the store re-seeds.
- **Prototype toolbar → Simulated data.**
  - Shows when the simulation was last saved.
  - **Reset simulation…** clears everything, including the simulated session and nudges, and reloads from the seed data. Theme and latency preferences are kept.
- **Limits.**
  - The data lives in one browser profile.
  - Two tabs don't sync: the last one to save wins.
  - If storage is full or blocked, the app still works but forgets on refresh.

## 3. What you can do now

| Area | Create | View | Edit | Lifecycle | Relationships / assign |
|---|---|---|---|---|---|
| **Organisations** (Humo: Platform.Customers.Manage) | Onboard customer (trial of a package, account manager) | Customers, customer page | Details | Onboarding → active ⇄ suspended → archived → restore. Suspend and archive need step-up. | Invite their first administrator |
| **Users** (Users & access: Users.Manage) | Invite with a first role and scope (step-up) | List, access drawer | Name, email, title | Invited (resend; prototype: "invitation accepted") · access suspended ⇄ restored · removed from agency (all roles end) | Add role with scope, end role (kept as history) |
| **Schemes** (Schemes.Manage: Agency Administrator) | Add (starts onboarding) | List (+ Archived tab), workspace | Details (code unique per agency) | Onboarding → active → closed → archived → restore. Can't archive with money owed. | Portfolio manager = role assignment |
| **Units** (Units.Manage: admin, portfolio manager) | Add to a scheme (opens a levy account) | List, unit page | Description, size, quota, levy, occupancy (number fixed) | — (not needed yet) | Owners and tenants from People |
| **People** (People.Manage: admin, portfolio manager) | Add owner, tenant or trustee, linked to a unit or board | List, person page | Contact details | — | Add a role; end a role on a date (sold, moved out, stepped down) |
| **Suppliers** (Suppliers.Manage) | Add (documents start missing) | List (+ Archived tab), supplier page | Details, trades, schemes | Active ⇄ on hold, archived ⇄ restored. Can't archive with open jobs. | Linked from Humo Contractor on quote acceptance |
| Jobs, receipts, payables, subscriptions, quote requests | Already simulated (earlier slices) | | | | |

**Every form:**
- checks required fields before sending;
- shows the server's validation messages next to the fields;
- keeps what was typed on failure;
- shows "Saving…";
- asks for step-up where the API requires it;
- sends the record's `version`, so a stale edit gets a conflict.

**Every change is audited:** who, as which role, in which organisation, and why (lifecycle changes require a reason).

**Server rules the simulation enforces:**
- Suspended or archived organisations, and suspended people, can't work. Signing in shows "Your access is paused" with the reason.
- Archived schemes leave everyone's scope. Archived suppliers aren't offered for new work.
- Nobody can change their own access.
- Unit numbers are unique per scheme, and a unit has only one tenant at a time.

## 4. Blind spots still open

| Gap | Why it matters | Suggested next step |
|---|---|---|
| A new customer's health shows **Critical** (no usage yet) | Misleading for onboarding accounts | Score onboarding customers separately (e.g. "Too new to score") |
| People without any role don't appear in lists | Someone added and then unlinked is only reachable by URL | A directory view of "No current role" |
| No duplicate-person merge | Real data has duplicates | Merge flow (backend-heavy; design with the API) |
| Units can't be archived or re-numbered | Rare, but happens on sectional-title extensions | Decide the rule with the domain experts first |
| Jobs can't be edited after logging (only commented on or cancelled) | Wrong category or title needs fixing | "Edit details" on the job, audited |
| No manual receipt capture or bank-statement import | Receipts only come from the seed | Bank import screen (Checkpoint 6) |
| Billing runs, communications, documents, governance, compliance, reports | Still placeholder pages | Per the build order |
| Platform: no editing of packages or the catalogue, and no Humo staff role administration | Humo can't change what it sells or who works at Humo | Catalogue editor, Humo team admin |
| Simulation is per browser | Two people can't share the same simulated data | Fine for prototyping; the real backend solves it |

## 5. Trying it

1. **As Thandeka (Agency Administrator):**
   - Schemes → **Add scheme**. Try the code `KC` to see the "already used" error, then `RG`.
   - In its Units tab → **Add unit**.
   - Workspace → **Mark active**.
   - People → **Add person**, as owner of that unit.
   - Settings → Users & access → **Invite someone**, then in their access drawer **Simulate: invitation accepted**, **Suspend access** and **Restore access**.
   - Suppliers → **Add supplier** → **Put on hold** → **Archive**.
2. **Refresh:** everything is still there.
3. **As Terry (System Administrator):**
   - Customers → **Onboard customer**, then **Invite their administrator**.
   - On Acacia → **Suspend**. Sign in as Thandeka: access is paused.
   - Back as Terry → **Reactivate**. Platform → Audit log shows it all.
4. **Start over:** prototype toolbar → **Reset simulation…**.
