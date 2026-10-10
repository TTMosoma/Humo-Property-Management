# Frontend readiness matrix

**Date:** 10 October 2026.

**Code audited:** branch `feature/identity-access` at `cf906bf` (open PR #3 into `main`). Read-only audit; no application code changed. It extends the earlier audit (`current-state-summary.md`) with a feature-by-feature readiness view, and checks the implementation against [docs/17-decisions.md](../17-decisions.md).

## 0. Which code is "the frontend"? Read this first

| Branch | What it contains (verified with `git show origin/<branch>:…/app.routes.ts`) |
|---|---|
| `main` | **No application.** Only the initial commit (`cbfb4a0`). |
| `feature/checkpoint-1-app-shell` (7 Oct) | 61 routes on the **"Planned screen"** placeholder |
| `feature/slice-a-owner-balance` (7 Oct) | 52 placeholder routes |
| `feature/slice-b-maintenance` (7 Oct) | 42 placeholder routes |
| **`feature/identity-access`** (10 Oct, PR #3, open, mergeable) | **0 placeholder routes**; 107 lazy-loaded route components (136 routable screens counting shared components); Humo team management present |

**Consequences:**
- Anyone running `main`, an older feature branch, or a build made from one, sees "Planned screen" pages and no Humo staff administration. That matches the concerns raised.
- **All the work described in docs 10–17 and in this audit exists only on `feature/identity-access`** until PR #3 is merged.
- PR #3's title ("Identity & access, Humo platform layer, and Humo Contractor foundation") no longer describes its content (Checkpoints 5–10, the Humo team fix, the audit, the decisions).

## 1. Status definitions

| # | Status | Meaning in this matrix |
|---|---|---|
| 1 | **Complete and verified** | Every action on the screen works end to end **in the simulation**, exercised in a browser in this session (audit W1–W8, the Humo team trace below, or the Checkpoint 10 tests). It still depends on the backend for real persistence. |
| 2 | **Implemented, requires verification** | Actions are implemented through data sources, but weren't exercised in this session. Earlier checkpoint docs report browser testing at the time. |
| 3 | **Partially implemented** | Works, with identified gaps, inert actions, or behaviour that contradicts an approved decision |
| 4 | **Placeholder or missing** | No functional implementation, or a stand-in for the real feature |
| 5 | **Blocked by a product decision** | Can't be finished until something not yet decided is decided |
| 6 | **Blocked by a backend dependency** | The frontend is ready, but the real behaviour needs a server capability |
| 7 | **Intentionally deferred** | Out of scope for the first release, by decision or documentation |

**Applies to every row:**
- **Persistence:** data is **simulated** (in-memory stores saved to this browser's localStorage, `mock/db`). Nothing is shared between users or devices. Every row is therefore also "blocked by a backend dependency" for real persistence; status 6 is used only where the frontend can't progress without the server.
- **States:** loading, error (with retry), empty and not-found states use shared components (`ui/states`). They're present on every list and record page inspected; not individually verified.
- **Validation:** server-side through `MockGateway.command(… validate …)`, shown as field errors in the form drawer (92 drawer forms, all submitting through a data source; none fakes success).
- **Permissions:** route `data.permission`/`feature` + `accessGuard` (UX only) and `session.can()` in templates. **Scope isn't enforced on commands or reads** (audit F-02, F-08).
- **Navigation:** all **62** navigation entries resolve to registered routes, and 78 of 79 static in-app links resolve. The 79th is a false positive: an id is appended at runtime.

---

## 2. Matrix

**Column abbreviations:**
- **E2E:** end-to-end status of create, read, update and delete/archive in the simulation. ✔ works · ◐ partly · ✖ missing · n/a.
- **Perm:** permission or feature gate. **Scope:** scope behaviour.

### Identity, session and access

| Feature · route | Component · data source | Role | Status | Actions | E2E | Perm · scope | Dependencies | Recommended action |
|---|---|---|---|---|---|---|---|---|
| Sign in · (none) / `/signed-out` | SignedOutPage · `SessionDataSource` | All | **4** Placeholder | "Sign in as" persona picker (prototype controls) | n/a | — | **D5** identity provider | Replace with the identity provider flow (slice 1) |
| Role switching · top bar | Topbar · `AccessDataSource.switchRole` | Multi-role users | **1** | Switch the active assignment | ✔ | Validated against held assignments | Token per assignment (backend) | Keep |
| Users & access · `/settings/users` | UsersPage, access drawer · `AccessDataSource` | Agency Administrator | **3** | Invite, edit, assign or end role, suspend, restore, remove, resend | ✔ (sim) | `Users.Manage`; admin roles need `Users.ManageAdmins` + step-up | **D3** (Portfolio Manager invites residents; invite from records) | Implement D3; refuse `@humo.example` addresses for new invites (§3 finding H-3) |
| Roles & permissions · `/settings/roles` | RolesPage | Agency Administrator | **2** | Read-only | n/a | `Users.Manage` | — | Keep; "Portal coming soon" label for some roles is intentional |
| Security · `/settings/security` | SecurityPage · `SecurityDataSource` | Everyone | **6** | Add or remove passkey, devices, sign out sessions (simulated) | ◐ | Self only; disabled during impersonation without explanation | **D5** WebAuthn | Implement with the identity provider |
| Audit log · `/settings/audit`, `/platform/audit` | AuditPage · `AuditDataSource` | Agency Administrator; Humo | **1** (platform view, Humo team entries) / **2** (agency view) | Filter, impersonation view, export (simulated) | R ✔ | `Audit.View` / `Platform.Audit` | Append-only store (backend) | Keep |
| Impersonation · `/platform/users` | PlatformUsersPage, ImpersonateDialog · `AccessDataSource` | System Administrator with `System.Impersonate` | **1** (Observe) / **2** (Act) | View as (Observe or Act), exit | ✔ | Individual grant; Act needs step-up | Session context (backend) | Keep |
| No access / not found | NoAccessPage, NotFoundPage | All | **1** | — | n/a | Plan versus permission reasons | — | Fix the wording under Observe (F-30), P3 |

### Humo platform (Humo staff)

| Feature · route | Component · data source | Role | Status | Actions | E2E | Perm · scope | Dependencies | Recommended action |
|---|---|---|---|---|---|---|---|---|
| **Humo team · `/platform/team`, `/:id`** | TeamPage, MemberPage, `team-forms.ts` · `HumoTeamDataSource` | System Administrator (manage); all Humo roles (view) | **3** (works; two defects, §3) | Invite, edit, give or end role, two-person System Administrator approval, impersonation grant, customers, suspend, restore, offboard | ✔ (sim; traced §3) | `Platform.ManageHumoRoles` on the current role; step-up `change-humo-team`; self-change refused; last System Administrator protected | Identity provider invitations (D5); audit store | Fix H-1 (restore → invited), H-2 (validate before step-up) |
| Customers · `/platform/customers`, `/:orgId` | CustomersPage, CustomerPage · `PlatformDataSource`, `OrganisationDataSource` | System Administrator, Account Manager, Support | **3** | Onboard, edit, mark live, archive, invite first administrator, subscription and features | ✔ (W1) | `Platform.Customers.*`; manage-features only for the customer's own account manager | — | Restrict first-administrator role (F-22, D3); fix wrong instruction text (F-21); breadcrumb (F-24); "Critical" health at onboarding (F-23) |
| Account manager book · `/platform/accounts` | AccountsPage | Account Manager | **2** | Health, subscriptions, opportunities, support | R | `Platform.Accounts.Own` | — | Verify |
| Executive · `/platform/executive` | ExecutivePage | Executive | **2** | Read-only figures | R | `Platform.Insights.View` | Figures are generated targets (`seed-platform` `TARGETS`) | **7** for real analytics |
| Packages & features · `/platform/packages` | PackagesPage | System Administrator | **2** | Read; nudge settings | R | `Platform.Subscriptions.View` | Catalogue editing absent (`docs/09`) | **7** catalogue editor |
| Document templates · `/platform/templates` | DocumentTemplatesPage | Humo | **2** | Publish versions, status, custom templates | ✔ (code) | `Platform.Templates.Manage` | PDF service (D8) | Verify |
| Feature flags · `/platform/flags` | FlagsPage, FlagPage · `OpsDataSource` | System Administrator | **2** | Rules per environment, kill switch, history | ✔ (code) | `Platform.Config.Manage` + step-up | Real flag service | Verify |
| Platform health · `/platform/health` | HealthPage | Support, System Administrator | **2** | Incidents, job retry | ✔ (code) | `Platform.Operations.*` | Metrics are simulated | **6** for real telemetry |
| System settings · `/settings/system` | SystemSettingsPage | System Administrator | **2** | Maintenance banner, upload limit, session and retention | U ✔ (code) | `Platform.Config.Manage` | Backend config | Verify |

### Portfolio

| Feature · route | Component · data source | Role | Status | Actions | E2E | Perm · scope | Dependencies | Recommended action |
|---|---|---|---|---|---|---|---|---|
| Schemes · `/schemes` | SchemesPage · `SchemeDataSource` | Staff | **1** | Add scheme, list, health | C R ✔ (W2) | `Portfolio.View`; **returns every agency's schemes, filtered in the browser** (F-08) | Scope in API (R2) | Server-side scope (slice 1) |
| Scheme workspace · `/schemes/:id/*` | SchemeWorkspace, SchemeOverview · `SchemeDataSource` | Staff, trustees | **3** | Edit, mark active, archive, tabs | U ✔ (W4) | **Any Portfolio Manager opens any scheme in the agency (contradicts D1)** | D1 permission | Implement D1 in the resolver (P0) |
| Units · `/units`, `/schemes/:id/units`, `…/:unit` | UnitsPage, UnitPage · `UnitDataSource` | Staff | **5** (levy) / **3** | Add, edit; no archive or renumber | C R U ✔ (W2), D ✖ | `Portfolio.Browse`, `Units.Manage` | **Levy versus quota model undecided** (F-14) | Decide the levy model; derive occupancy from relationships (F-25) |
| People · `/people`, `/people/:id` | PeoplePage, PersonPage · `PersonDataSource` | Staff | **3** | Add with relationship, edit, add or end role, log call or note | C R U ✔ (W3), D ✖ (no merge) | `People.Manage` | **D2**: trustee from People must go; **D3**: invite action missing | Implement D2 and D3 on this page |
| Levy account · `…/account` | AccountPage · `AccountDataSource` | Staff | **3** | Balance breakdown, allocate suggestion, journal adjustment; **"Re-send statement" is a toast** | R ✔ (W6) | `Accounts.View` | **D7/D9** issued statements and delivery | Remove or label the inert action (P0); implement with D7/D9 |
| Statement · `…/statements/:period`, `/my/statements/:period` | StatementPage, LevyStatementDocument | Staff, owner | **3** | View, print; **"Email statement" is a toast** | R ✔ (W6) | `Account.ViewOwn` for owners | **D7** (re-renders from current data), **D8** PDF | Mark as a preview until D7; P0 label fix |
| Scheme finance · `/schemes/:id/finance` | SchemeFinance | Staff | **1** | Read-only summary | R ✔ | `Finance.View` | — | Keep |
| Staff · `/staff`, `/:id` | StaffPage, StaffMemberPage · `StaffDataSource` | Staff | **3** | Away cover set and end | ✔ (Checkpoint 10) | `Work.Manage` | **Routing uses seed identities** (F-03) | Derive from live assignments (P0) |

### Work

| Feature · route | Component | Role | Status | Notes | Recommended action |
|---|---|---|---|---|---|
| Tasks · `/tasks` | TasksPage · `WorkItemDataSource` | Staff | **2** | Complete, reopen, assign. Onboarding schemes flood it with false overdue compliance Tasks (F-12). | Fix F-12 (P0) |
| Approvals · `/approvals` | ApprovalsPage | Approvers | **2** | Decide with comment. **D6** conflict rule missing. | Implement D6 with slice 4 |
| Inbox · `/inbox` | InboxPage · `InboxDataSource` | Staff | **1** | Inbound email and SMS not modelled (**6**) | Keep |
| Dashboard · `/dashboard` | DashboardPage | Staff | **2** | Heuristic health | Verify |

### Finance

| Feature · route | Status | Notes | Recommended action |
|---|---|---|---|
| Billing · `/finance/billing`, `/:runId` | **2** | Full run lifecycle in code; posting adjusts stored balances (ledger isn't the source of truth, F-04) | Slice 2, after the levy model decision |
| Receipts · `/finance/receipts` | **3** + **6** | Allocate, split, suspense, unallocate ✔ (code). **No receipt capture or bank import**: receipts come only from seed data. | Bank import design (slice 3) |
| Credit control · `/finance/credit-control/*` | **2** | Post letters aren't recorded in Sent | Slice 3 |
| Payables · `/finance/payables` | **2** | Batch release with step-up; **D6** | Slice 4 |
| Budgets · `/finance/budgets/*` | **1** | Checkpoint 10 tests; insurance, utilities, fees and audit not tracked (**6**) | Keep |

### Maintenance and suppliers

| Feature · route | Status | Notes | Recommended action |
|---|---|---|---|
| Log request · `/maintenance/new`, `/my/requests/new` | **1** (W5) | Photo files aren't stored (**6**) | Keep |
| Job · `/maintenance/:ref` | **3** | Lifecycle verified only to triage in this audit; **no "edit details"**; unassigned when the scheme has no portfolio manager (F-29) | Verify the full lifecycle; add edit (P2) |
| Quotes · `…/quote-request`, `…/quotes` | **3** | "Message through Humo" and email invites are toasts (F-16); network quoting belongs to Humo Contractor | **7** for messaging; label the toasts |
| Suppliers · `/suppliers`, `/:id` | **2** | Create, edit, status, bank change with step-up | Verify |

### Communications and documents

| Feature · route | Status | Notes | Recommended action |
|---|---|---|---|
| Notices · `/communications/notices` | **2** | | Verify |
| Compose, Sent · `/communications/compose`, `/sent/*` | **1** | Delivery is simulated (**6**) | Keep |
| Templates · `/communications/templates` | **2** | Editing not exercised | Verify |
| Library · `/documents`, `/:docId` | **3** + **6** | **Uploaded files don't persist after the session** (object URLs) | Backend storage (slice 6) |
| Documents & templates · `/settings/documents` | **2** | Branding with step-up | Verify |

### Governance and compliance

| Feature · route | Status | Notes | Recommended action |
|---|---|---|---|
| Meetings and resolutions · `/governance/meetings/*`, `/resolutions` | **2** | | Verify |
| Trustee boards · `/governance/trustees/*` | **3** | Verified (Checkpoint 10), but **contradicts D2**: appointing doesn't grant access; trustee access can exist without board membership (seed: Sarah, Mpho); no invite (D3) | Implement D2 (P0 decision alignment) |
| Rules and breaches · `/governance/rules/*` | **1** | Checkpoint 10 tests | Keep |
| Compliance · `/compliance`, `/:itemId` | **3** | False overdue for onboarding schemes (F-12) | Fix (P0) |
| Reports · `/reports/*` | **2** | 13 reports; print and CSV | Verify |

### Settings and resident portal

| Feature · route | Status | Notes |
|---|---|---|
| Profile, notifications, billing settings, plan | **2** | Implemented; not exercised in this session |
| Agency and trust accounts · `/settings/agency` | **2** | Read verified (W8, Observe); trust account change with step-up not exercised |
| Resident home, account, requests, documents, notices · `/my/*` | **2**, `/my/account` and `/my/statements` **1** (W7) | Visibility enforced in the mock (`library-store` `visible()`) |
| Resident messages · `/my/messages` | **1** | Checkpoint 10 tests |

### Intentionally deferred (status 7)

| Feature | Reason |
|---|---|
| Humo Contractor portal · `/contractor/*` | A separate Humo product (doc 07), prototyped behind its own shell |
| Configurable role profiles | **D4**: fixed roles in v1 |
| Catalogue editing, real executive analytics | `docs/09`, platform later |
| Bulk resident invites | **D3**: later |
| Network messaging, email quote invites | Humo Contractor |

### Dead code

`features/planned/planned-page.*` and the `planned()` helper in `app.routes.ts:19` are unused on this branch. They're the source of the "Planned screen" text on older branches.

---

## 3. Humo internal staff administration: traced

**Live trace on 10 October 2026:**
- Persona Terry Mosoma, working as Humo System Administrator.
- Dev server on `feature/identity-access`.
- Simulated passkey for step-up.

| Question | Answer | Evidence (file · symbol, and live result) |
|---|---|---|
| Can the System Administrator see a list of internal Humo employees? | **Yes.** Tabs: Team, Invited, Suspended, Former. Columns: person, roles, customers, status, last active. | Nav entry `platform-team` (`core/navigation/nav.config.ts`) → route `platform/team` (`app.routes.ts`) → `TeamPage` (`features/platform/team/team-page.ts`) → `HumoTeamDataSource.list()` (`domain/ports/access-data-sources.ts`) → `InMemoryHumoTeamDataSource.list` (`mock/data-sources/in-memory-humo-team-data-source.ts`). Live: sidebar shows **Humo team**, tabs "Team 6 · Invited 1 · Suspended 0 · Former 1". |
| Can they invite or create an internal employee? | **Yes**, through *Invite to the team* (name, Humo email, job title, role, what they do, why). | `inviteMemberForm` (`team-forms.ts`) → `InMemoryHumoTeamDataSource.invite` → `AccessStore.addIdentity` + `grantRole`. Live: invited "Zinhle Readiness" (Support) → step-up → toast "Invitation sent." → member page `/platform/team/humo-38`. |
| Can they assign an approved internal role? | **Yes.** The role list is limited to the 4 Humo roles (`HUMO_ROLES`). System Administrator becomes a **pending request** that a *second* System Administrator approves. | `grantRoleForm`; `act(…, { type: 'grant-role' })`; `HumoTeamStore.pending`; `approve-grant`, whose check refuses the requester and the subject. Live earlier in this session: Kagiso requested by Terry, refused for Terry, approved by Nomsa (`docs/16`). |
| Can they activate, suspend or deactivate? | **Yes:** suspend, restore, offboard (deactivate: roles end, sessions end, customers reassigned). "Activate" happens when the invitee accepts (simulated in the prototype through *Simulate: invitation accepted*). | `statusForm`, `offboardForm`; `apply()` cases `suspend`, `restore`, `offboard`; `MockPrototypeControls.acceptInvite`. Live: Zinhle suspended → status **Suspended**, actions "Restore access · Offboard". |
| Does the new employee appear in the list? | **Yes, and after a full page reload.** "Team 7 · Invited 2" with Zinhle listed as Invited. | Live, after `location.href` reload |
| Persisted, simulated or displayed only? | **Simulated persistence:** `AccessStore` and `HumoTeamStore` save to localStorage (`simulationStorage` keys `access`, `humo-team`). Per browser; no server. | `mock/db/access-store.ts`, `mock/db/humo-team-store.ts` |
| Are internal staff distinguished from agency staff? | **Yes, mostly.** `Identity.kind = 'humo'`; Humo roles have `platform` scope; agency lists exclude Humo identities (`directory()` filters `kind === 'customer'`); Humo invites require `@humo.example`. **Gap H-3:** an agency invite refuses only an email that already belongs to a Humo identity. A *new* `@humo.example` address is accepted as agency staff. | `in-memory-access-data-sources.ts:75` (`existing?.kind === 'humo'` only) |
| Are permissions enforced by the intended model? | **In the simulation, yes:** the gateway checks `Platform.ManageHumoRoles` on the **current** role (Nomsa was refused while working as Executive), step-up is required, self-change is refused, the last System Administrator is protected, and two-person approval applies. **Not real security:** the frontend and mock run in the browser (F-05). | `MockGateway.authorise`; `InMemoryHumoTeamDataSource.check` |
| Is the invitation flow real, mocked or absent? | **Mocked.** No email is sent; acceptance is simulated; passkey enrolment is simulated. | `MockPrototypeControls.acceptInvite` |

**Defects found in the trace:**

| ID | Defect | Evidence | Fix |
|---|---|---|---|
| H-1 | **Restoring someone suspended while still *invited* makes them *Active*** although they never accepted or enrolled a passkey | `in-memory-humo-team-data-source.ts:310–311` sets `status: 'active'` unconditionally | Restore to the status held before suspension (keep `previousStatus`) |
| H-2 | **Step-up is asked before validation:** you verify with a passkey, then learn the email is a duplicate or outside the Humo domain | Live: duplicate "ZINHLE@humo.example" prompted for a passkey, then showed "Someone already signs in with this email." The gateway order is authorise → validate. | Run validation before requesting step-up (a pre-check endpoint or validate-only mode) |
| H-3 | Agency invites accept new `@humo.example` addresses | See above | Refuse the Humo domain in agency invites |

**Conclusion:** Humo staff administration **exists and works end to end in the simulation**, but **only on `feature/identity-access`**. It meets the minimum workflow asked for:
- a list;
- an explicit invite action;
- a form with name, email and role;
- validation and duplicate handling;
- invited, active, suspended and former states;
- step-up plus a reason for consequential changes;
- a second approver for System Administrator;
- loading, success, empty and error states;
- an audited command for each action.

Three defects remain (H-1 to H-3).

---

## 4. Readiness, by dimension

| Dimension | Assessment | Evidence |
|---|---|---|
| **Build stability** | **Stable.** Strict type-check and production build pass; one bundle-size warning. | Audit evidence C3, C5 |
| **Functional UI completion** | **High breadth, uneven depth.** 0 placeholder routes on this branch, but 4 inert toast actions, missing actions required by D2 and D3, and the defects listed. "Complete and verified" (status 1) applies to about a fifth of the screens; most are status 2. | This matrix |
| **Simulated CRUD readiness** | **Good for portfolio, governance, communications and the platform; gaps elsewhere:** no receipt capture, no job edit, no unit or person archive or merge, files not persisted | `crud-and-data-integrity-matrix.md` |
| **Backend integration readiness** | **Seam ready, rules not.** 40 ports; every write through one gateway; API conventions written (`docs/08`). The scope rule isn't yet in the contract; business rules live only in mock code; **no tests**. | Roadmap R2–R4 |
| **Release readiness** | **Not releasable.** Persona sign-in, mocks and prototype controls in the production bundle, no real persistence, no scope enforcement, and `main` contains no application. | F-05, F-02, F-08, §0 |

**Previous statements that need correcting:**
- `current-state-summary.md` ("No placeholder screens remain") is true **only for `feature/identity-access`**.
- `README.md`'s "Backend readiness (P1/P2)" ticks describe contract preparation (`GET /me` shape, paging, versions), **not** backend integration readiness.
- My own earlier summaries in this session described screens as built and tested. That was accurate for the simulation on this branch, but didn't make clear that `main` is empty and the work is unmerged.

**Can start backend integration now** (workflow, validation and permissions defined, once R2 adds the scope rule):
- organisations, schemes, units, people and relationships (with D2 and D3 applied);
- Users & access;
- Humo team;
- audit;
- session bootstrap.

**Needs frontend work or decisions first:**
- levy and billing (levy model; D7);
- statements (D7, D9);
- trustee boards (D2);
- receipts (bank import);
- library (storage).

---

## 5. Contradictions with `docs/17-decisions.md`

These are expected: the decisions are new and not yet implemented.

| Decision | Current implementation | Gap |
|---|---|---|
| D1 scope by assignment | `scheme.resolver.ts` lets any `portfolio-manager` open every scheme in the agency; no "browse all" permission exists | Contradiction |
| D2 board is the source of truth | People form offers "Trustee of a scheme"; appointing on the board doesn't grant access; seed trustee access without board membership (Sarah, Mpho) | Contradiction |
| D3 resident invites | Only the Agency Administrator in Settings; no invite on person, unit or board; first-administrator invite allows any role | Not implemented |
| D4 checks by permission | 29 `role ===` checks remain (some security-relevant) | Partly |
| D5 identity provider | Persona picker | Not implemented (backend) |
| D6 staff conflict rule | No rule | Not implemented |
| D7 immutable issued statements | `MockDb.statement()` re-renders from the current ledger, holder and trust account | Contradiction |
| D8 PDF service | Browser print only | Not implemented (backend) |
| D9 link delivery | Email and re-send are toasts; no agency setting | Not implemented |
| D10 numbering | Custom templates show a *derived* reference (prefix + period + account), not a counter, which is consistent with D10. D10's wording "replaces a simulated statement number" overstates the current state. | Consistent; wording nit |

**Other documentation contradictions:**
- `docs/16` says *"agency invites refuse Humo addresses"*: only for existing Humo identities (H-3).
- `docs/09` §4 still lists built features as placeholders (F-34).
- The PR #3 title is out of date (§0).
