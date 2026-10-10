# CRUD and data-integrity matrix

## How data flows today (observed)

```
Feature component ──► domain port (abstract XDataSource, 40 of them) ──► InMemory adapter (mock/data-sources)
                                                                          │ reads: store → mockResponder (latency) → Observable
                                                                          │ writes: MockGateway.command(spec, apply)
                                                                          ▼
                                                     mock store (mock/db, 22 persisted stores) ──► localStorage `humo.sim.<key>`
```

- **Components never touch stores or `mock/`.** No feature, core or ui file imports from `mock/` (evidence log §2). Writes go through ports.
- **Every write passes `MockGateway.command`**, which applies:
  1. Observe-mode refusal;
  2. a **permission** check (the current role);
  3. an **entitlement** check;
  4. **step-up** freshness;
  5. **version** (409);
  6. **validation** (422 field errors);
  7. **audit** (success and denied).

  **Scope is not checked** (F-02).
- **Persistence:** each store saves its own snapshot (`simulationStorage`, schema 2) to the browser's localStorage. It survives refresh; it's per browser; it isn't shared between users.

## Entity matrix

| Abbreviation | Meaning |
|---|---|
| **C R U D/A** | create, read, update, delete or archive |
| ✔ | implemented |
| — | not implemented |
| (lc) | through lifecycle commands, not generic CRUD |

**Persistence** for every row is localStorage, per store key (in brackets), unless noted. **Audit:** the gateway records every command (✔) unless noted.

| Entity | C | R | U | D/A | Validation (server-side mock) | Search, filter, sort, page | Relationships | Store [key] | Limitations and evidence |
|---|---|---|---|---|---|---|---|---|---|
| **Organisation** (agency) | ✔ platform onboarding | ✔ | ✔ details | Status (lc): onboarding → active → suspended → archived | Required fields | List (no paging) | → Subscription, memberships, schemes | OrganisationStore [organisations] | Health "Critical" at creation (F-23) |
| **Subscription / package / add-on / entitlement** | Created at onboarding | ✔ | (lc) `changeSubscription` (package, add-on, trial override), step-up | — | Reason required | — | → Organisation | PlatformStore [platform] | Catalogue not editable (`docs/09`). Account manager stored by **name and id** (F-10). |
| **Identity** | ✔ invite (agency, platform, Humo team) | ✔ | ✔ details | Suspend, deactivate (Humo team); remove membership (agency) | Name, email, uniqueness, Humo domain | Client filter | → memberships → role assignments | AccessStore [access] | One identity per email; no real identity provider (F-05) |
| **Membership** | With invite | ✔ | Status | Ended (kept) | Can't change your own | — | Identity ↔ Organisation | AccessStore | |
| **Role assignment** | ✔ assign | ✔ | — | Ended (kept) | Duplicate, self-escalation, admin needs `Users.ManageAdmins` | — | → scope (organisation, schemes, unit, party, platform) | AccessStore | **Not linked to trustee board membership** (F-06) |
| **Humo grant (pending System Administrator)** | ✔ | ✔ | — | Approve or decline | Second approver | — | Identity | HumoTeamStore [humo-team] | |
| **Scheme** | ✔ | ✔ (**all agencies returned**, F-08) | ✔ | Status (lc) prospect → onboarding → active → closed → archived | Name, code | Client filter | → units, trust account, compliance profile, board | MockDb [portfolio] | Portfolio manager derived from **seed** identities in most stores (F-03) |
| **Unit** | ✔ | ✔ | ✔ | — (no archive or renumber) | Number unique, quota, levy | Paged port (`Page<UnitSummary>`), client filter | → scheme, account, relationships | MockDb [portfolio] | Quota and levy independent (F-14) |
| **Person** | ✔ (with first relationship) | ✔ | ✔ | — (no delete or merge) | Name, contact | Paged port, client filter | → relationships | MockDb [portfolio] | People with no current role are hidden from lists |
| **Relationship** (owner, tenant, trustee) | ✔ | ✔ | — | Ended (`until`, kept) | Unit and scheme match | — | Person ↔ Unit or Scheme | MockDb [portfolio] | Trustee via People bypasses board rules (F-28); start date defaults to the UTC day (F-26) |
| **Levy account** | Auto, with the unit | ✔ | Journal adjustment (lc), status derived | — | Reason | — | Unit ↔ holder (person) | MockDb [portfolio] | **Balance is stored and adjusted step by step** (`rebalance`) |
| **Ledger transaction** | (lc) billing post, allocation, adjustment | ✔ | — | — | — | — | → Account | MockDb [portfolio] (`extraTx`) | **History before the session is generated backwards from the seeded balance** (`ledger()`); it isn't the source of truth (F-04) |
| **Statement** | Rendered on demand | ✔ | — | — | — | — | → Account, period, template version | MockDb (`issued`) | Email and re-send are toasts (F-15) |
| **Receipt** | **— (seed only)** | ✔ | (lc) allocate, split, unallocate, suspense | — | Allocation totals, version | Paged port | → accounts | MockDb [portfolio] | **No capture or bank import** |
| **Payer rule** | (lc) "remember payer" | — | — | — | — | — | → account | MockDb | |
| **Note / call log** | ✔ | ✔ | — | — | — | — | → unit or person | MockDb | Not editable (by design) |
| **Work item** (Task, Approval) | System-created | ✔ | (lc) complete, reopen, assign, decide | — | — | — | → source record (ref, route) | MockDb [portfolio] | Can be created unassigned (F-12, F-29) |
| **Billing run** | ✔ | ✔ | (lc) calculate, exceptions, approve, post (locks), send statements | — | Stage rules, kill switch | — | → scheme, period, accounts, approval | BillingStore [billing] | Posting changes balances in MockDb (cross-store) |
| **Collection case** | Implicit per account | ✔ | (lc) letters, approvals, arrangement, dispute, hand-over | — | Stage rules | — | → account, work items, Sent | CollectionsStore [collections] | Post letters aren't recorded in Sent |
| **Job** (maintenance) | ✔ (staff, resident, inbox) | ✔ | (lc) 14 actions (triage … close, cancel) | Cancel | Stage rules, version | Paged port | → scheme, unit, supplier, quotes, invoice | MaintenanceStore [maintenance] | **No edit-details action** |
| **Quote / work order / invoice / payment batch** | (lc) | ✔ | (lc) | — | Delegation limits, approvals, step-up on release | — | → job, supplier, budget line | MaintenanceStore | Budget line lookup goes through the injector (avoiding a circular dependency) |
| **Supplier** | ✔ | ✔ | ✔ | Status (lc) | Required, bank change with step-up | — | → trades, schemes served, vetting documents | MaintenanceStore | |
| **Meeting / agenda item / attendance / minutes** | ✔ | ✔ | (lc) | Cancel | Notice period, quorum, stage | — | → scheme, resolutions, documents | GovernanceStore [governance] | |
| **Resolution / action** | (lc) at a meeting or written | ✔ | (lc) | — | Votes ≤ present | — | → meeting, agenda item, work items | GovernanceStore | Budgets and board elections depend on resolutions |
| **Budget / budget line** | ✔ (draft next year) | ✔ | Lines while draft | — | Status rules | — | → scheme, AGM agenda item, resolution | BudgetStore [budgets] | Actuals derived from invoices plus brought-forward (seeded) |
| **Trustee board** (trustee relationships + minimum) | (lc) appoint | ✔ | Portfolio, minimum | End term (kept) | Owner, resolution for elected, one chair | — | → relationships, compliance item | BoardStore [boards] + MockDb | See F-06 |
| **Scheme rule / version / rule book** | ✔ | ✔ | Amend (new version) | Repeal (kept) | Resolution required | — | → scheme, resolution, library document | RulesStore [rules] | |
| **Breach** | ✔ | ✔ | (lc) warn, refer, resolve, reopen | — | Stage rules | — | → rule, unit, person, Sent, Tasks | RulesStore | |
| **Library document** | ✔ upload | ✔ | ✔ details, visibility | Archive | Visibility per record kind | Client filter | → records (scheme, unit, person, supplier, job, meeting) | LibraryStore [library] | **File content isn't persisted** (object URL for the session only) |
| **Document template / version / branding** | ✔ custom (platform) | ✔ | Publish version, defaults, branding | Status (lc) | Version | — | → organisation, document type | DocumentStore [documents] | |
| **Notice** | ✔ | ✔ | Pin | Withdraw | — | — | → scheme, audience, Sent | NoticeStore [notices] | |
| **Message template / sent message / delivery** | ✔ | ✔ | ✔ template | Archive template; cancel scheduled | Audience, channels | Client filter | → audience, people | CommsStore [comms] | Deterministic delivery outcomes |
| **Conversation** | ✔ (resident, inbox) | ✔ | (lc) | Close | — | — | → person, unit, work item, jobs | InboxStore [inbox] | |
| **Compliance item** | **Generated** + manual | ✔ | (lc) record, upload evidence | — | — | — | → scheme, financial year, meetings, documents, suppliers | ComplianceStore [compliance] | False overdue for new schemes (F-12) |
| **Staff cover** | ✔ | ✔ | — | End | Dates | — | → staff, work items | StaffStore [staff] | |
| **Settings** (agency, billing, notifications, trust account, compliance profile, preferences) | — | ✔ | ✔ (trust account with step-up) | — | Per form | — | → organisation or scheme | SettingsStore [settings], MockDb (trust) | |
| **Feature flag / incident / system config** | Incidents ✔ | ✔ | ✔ | Resolve | Reason, step-up | — | Platform-wide | OpsStore [ops] | |
| **Audit event** | System | ✔ | — | — | Append-only | Paged port | Actor, acting-as, scope | AccessStore [access] | **Stored in the browser** and editable through devtools (simulation) |
| **Contractor party** | ✔ link | ✔ | ✔ | — | — | — | Humo Contractor | ContractorStore [contractor] | Separate product |

## Lifecycle operations that must not be generic CRUD (observed in the ports)

Job actions (triage, request quotes, send for approval, approve within delegation, issue work order, start, complete, verify, capture invoice, close, cancel) · billing run (calculate, approve, post, send statements) · receipt allocation, unallocation, suspense · journal adjustment · payment batch create and release · collection steps (letters, demand approval, hand-over, arrangement, dispute) · meeting stages (notice, pack, attendance, minutes, approval) · resolutions (record, written proposal, decide) · budget (propose to AGM, approval by resolution) · trustee appoint and end term · rule add, amend, repeal and share · breach warn, refer and resolve · subscription changes · role assignment and membership status · Humo team grants with two-person approval · impersonation start and end · scheme status changes · work-item decide and complete.

## Data-integrity findings

| ID | Finding | Evidence | Impact | Severity |
|---|---|---|---|---|
| F-03 | **Two sources of truth for "who is the portfolio manager".** The scheme page uses live identities (`portfolioManagerOf(s.id, this.access.identities())`). Compliance, inbox, maintenance, rules and the MockDb scheme seed use the **seed** list (default `PERSONAS`). `personName()` also resolves names from seed data. | `mock/fixtures/staff.ts`, 10 callers | A portfolio manager assigned in Users & access shows on the scheme but doesn't receive routed Tasks. Renamed or new staff show stale names or raw ids. | High (backend must derive it from live assignments) |
| F-06 | **Trustee access ≠ trustee board.** Board membership is a `Relationship` (MockDb); trustee *access* is a `RoleAssignment` (AccessStore). Sarah Jacobs (agency staff) holds a trustee role at Kingfisher Court but isn't on its board. Mpho holds a trustee role at The Willows without a linked person record. Appointing a trustee doesn't grant access; ending a term does revoke it. | `personas.ts:93,160,265`; `board-store.ts` | Approvals and quorum can be inconsistent with the board register | High (product decision) |
| F-04 | **Balances aren't derived from transactions.** `Account.balance` is stored and adjusted incrementally; the pre-session ledger is generated backwards from it. | `mock-db.ts` `ledger()`, `rebalance()` | The backend must make the transaction ledger the source of truth and derive balances and ageing | High (design) |
| F-09 | **22 independently persisted stores.** Resetting or upgrading one store's snapshot leaves the others inconsistent (seen during development: reseeding rules duplicated letters in Sent). Seeds are relative to the day each store was first seeded. | `simulation-storage.ts`, 22 keys | Prototype only; confusing reviews | Low (simulation) |
| F-10 | **Denormalised names.** Customer `accountManager` (name) is stored next to its id; renaming a Humo team member doesn't update it. The same pattern appears in `reportedBy`, `by` and `assigneeName` strings across stores. | `platform-store.ts`, `seed-platform.ts` | Stale names after edits | Medium |
| F-14 | Participation quota and monthly levy are independent inputs. | W2 | Levies can contradict the quota | Medium (decision) |
| F-26 | Date defaults in UTC (`toISOString().slice(0, 10)`, 17 uses). | W3 | Off-by-one dates around midnight in South Africa (UTC+2) | Medium |
| F-12 | Compliance generated without regard to scheme onboarding: creates overdue, unassigned Tasks. | W4 | Noise and false alarms for every new scheme | High (UX and trust) |
| F-28 | Two paths create trustee relationships (People form; board) with different rules. | W3 | Board register bypassed | Medium |
| F-36 | Uploaded files aren't persisted (object URLs for the browser session only). | `library-store.ts` `files` | Documents "exist" without content after refresh | Simulation-only; the backend needs storage |
| F-37 | **Cross-store writes without transactions:** billing post → MockDb balances; breach warn → CommsStore + work items; budget propose → GovernanceStore agenda. A failure mid-apply would leave a partial state. In the mock, `apply()` is synchronous. | Store code | The backend needs transactional boundaries or outbox events per command | Medium (design) |
