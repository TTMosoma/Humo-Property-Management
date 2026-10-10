# Screen completeness matrix

**Source:** `src/app/app.routes.ts` (136 component routes plus redirects; no `planned()` placeholders remain) and `core/navigation/nav.config.ts`.

**Every screen is backed by the in-memory simulation.** "Mock/simulated" applies to all of them, so the status column says how far the simulated behaviour was checked:

| Status | Meaning |
|---|---|
| **Verified (sim)** | Exercised in the browser in this session (the audit's W1–W8, or the Checkpoint 10 and Humo team tests earlier in the session) |
| **Impl., not verified** | The implementation is present, but it wasn't exercised in this audit. Earlier checkpoint docs may report testing. |
| **Partial** | Identified gaps |
| **Planned** | No functional implementation |

**Priority:** **P1** fix before or during the first backend slice · **P2** fix during the module's backend slice · **P3** later

Common to every screen (by code inspection):
- loading, error (with retry), empty and not-found states;
- a page header;
- route-level `permission` and `feature` gating (UX only);
- forms in the shared form drawer, with field-level server errors.

Responsive and accessibility behaviour was **not** systematically tested (see the evidence log).

---

## Identity, shell and access

| Route | Component | Purpose / main roles | Implemented | Missing or non-functional | Status | Priority / action |
|---|---|---|---|---|---|---|
| `/signed-out` | SignedOutPage | Signed-out landing (all) | Product name, reasons (suspended, …), sign in again | No real sign-in: the persona is chosen in prototype controls | Impl., not verified | P1: replace with the identity provider flow |
| `/no-access`, `/not-found`, `/**` | NoAccessPage, NotFoundPage | Denied or unknown pages | Shown in place with the URL kept; plan versus permission reasons | Plan text wrong while impersonating (F-30) | Verified (sim) W7, W8 | P3 |
| Shell (topbar, sidebar, scope chip, role switcher, maintenance banner, impersonation banner, prototype toolbar) | Shell, Topbar, … | Navigation and context | Role switching, scheme scope, pinned schemes, theme, sign out, search (Ctrl K) | The prototype toolbar ships in the production build (F-05) | Verified (sim) | P1: gate prototype providers by environment |
| `/settings/users` | UsersPage + access drawer | Agency users (Agency Administrator) | Invite, edit, add or end role, suspend, restore, remove, resend | No invite from the person, unit or board record (F-27); Portfolio Managers can't invite residents (decision) | Impl., not verified (this audit) | P2 |
| `/settings/roles` | RolesPage | Explain the access model | Read-only roles, permissions, holders | "Portal coming soon" label on some roles | Impl., not verified | P3 |
| `/settings/security` | SecurityPage | Own passkeys, devices, sessions | Add or remove passkey, sign out sessions (simulated) | No real WebAuthn | Impl., not verified | P1 (identity provider) |
| `/settings/audit` | AuditPage | Agency audit log (`Audit.View`) | Filters, impersonation view, export | Export is simulated | Impl., not verified | P2 |

## Work and dashboard

| Route | Component | Purpose | Implemented | Missing | Status | Priority |
|---|---|---|---|---|---|---|
| `/tasks` | TasksPage | Work items for me or the team | Complete, reopen, assign, filters | No push updates (polling or live store only) | Impl., not verified | P2 |
| `/approvals` | ApprovalsPage | Approve or reject (quotes, invoices, billing runs, letters) | Decide with comment; budget-line context | — | Impl., not verified | P2 |
| `/inbox` | InboxPage | Resident conversations (`Messages.Reply`) | Reply, assign, close, reopen, make a job or Task | Inbound email and SMS not modelled | Verified (sim): Checkpoint 10 | P2 |
| `/dashboard` | DashboardPage | Today, since yesterday, portfolio health, workload | Computed from stores | Health scoring is heuristic | Impl., not verified | P3 |
| `/staff`, `/staff/:id` | StaffPage, StaffMemberPage | Workload and away cover | Set and end cover with work hand-over | Routing uses seed identities (F-03) | Verified (sim): Checkpoint 10 | P1 (F-03) |

## Portfolio

| Route | Component | Purpose | Implemented | Missing | Status | Priority |
|---|---|---|---|---|---|---|
| `/schemes` | SchemesPage | Scheme list | Add scheme, filters, health | — | Verified (sim) W2 | — |
| `/schemes/:id/overview` | SchemeOverview | Scheme summary | Edit, mark active, archive, attention list | New schemes show false overdue compliance (F-12) | Verified (sim) W4 | P1 (F-12) |
| `/schemes/:id/units`, `/units` | UnitsPage | Units | Add unit | No archive or renumber (`docs/09`); quota versus levy (F-14) | Verified (sim) W2 | P2 |
| `/schemes/:id/units/:unit` | UnitPage | Unit record | Edit, people, open work, documents, timeline | "Owner-occupied" with no owner (F-25) | Verified (sim) W3 | P3 |
| `…/account` | AccountPage | Levy account | Balance breakdown, receipt suggestion, journal adjustment | **"Re-send statement" is a toast only** (F-15) | Verified (sim) W6 | P2 |
| `…/account/statements/:period`, `/my/statements/:period` | StatementPage | Levy statement document | Template render, print | **"Email statement" is a toast only** (F-15); no PDF | Verified (sim) W6 | P2 |
| `/people`, `/schemes/:id/people` | PeoplePage | Directory | Add person with a relationship | People with no current role aren't listed (`docs/09`); no merge | Verified (sim) W3 | P2 |
| `/people/:id` | PersonPage | Person record | Edit, add or end role, call or note log, documents | "Portal access: not invited" has no action (F-27); trustee role bypasses board rules (F-28) | Verified (sim) W3 | P2 |
| `/schemes/:id/finance` | SchemeFinance | Scheme's finance summary | Levy roll, receipts, arrears, payables, budgets | — | Verified (sim): Checkpoint 10 | — |

## Finance

| Route | Component | Purpose | Implemented | Missing | Status | Priority |
|---|---|---|---|---|---|---|
| `/finance/billing` | BillingPage | Billing status per scheme | Start a run | — | Impl., not verified | P1 (core slice) |
| `/finance/billing/:runId` | BillingRunPage | Billing run lifecycle | Calculate, exceptions, send for approval, post (locks), send statements | Statements emailed only when the kill switch allows; per-account detail for pre-Humo runs absent | Impl., not verified | P1 |
| `/finance/receipts` | ReceiptsPage | Allocate bank receipts | Allocate, split, suspense, remember payer, unallocate | **No receipt capture or bank import** (receipts come only from the seed) | Impl., not verified | P1 |
| `/finance/credit-control`, `/:accountId`, `/letters/:stepId` | CreditControlPage, CollectionPage, CollectionLetterPage | Arrears pipeline | Reminders, final demand, trustee approval for demand, hand-over, arrangement, dispute, letters | Post isn't recorded in Sent | Impl., not verified | P2 |
| `/finance/payables` | PayablesPage | Supplier invoices and payment batches | Batch, release with step-up | — | Impl., not verified | P2 |
| `/finance/budgets`, `/:budgetId` | BudgetsPage, BudgetPage | Budgets and the AGM | Draft, lines, put to AGM, approved by resolution, actuals | Insurance, utilities, fees and audit not tracked | Verified (sim): Checkpoint 10 | P3 |

## Maintenance and suppliers

| Route | Component | Purpose | Implemented | Missing | Status | Priority |
|---|---|---|---|---|---|---|
| `/maintenance`, `/schemes/:id/maintenance` | JobsPage | Job list | Filters | — | Impl., not verified | P2 |
| `/maintenance/new`, `/my/requests/new` | RequestForm | Log a request (staff or resident) | Unit search, category, area, priority, photos (name only) | Photos aren't stored (prototype) | Verified (sim) W5 | P2 |
| `/maintenance/:ref` | JobPage | Job lifecycle (13 stages) | Triage, quotes, approval, work order, start, complete, verify, invoice, close, cancel, comments | **Can't edit job details** (`docs/09`); unassigned when the scheme has no portfolio manager (F-29) | Partial (W5 to triage only) | P2 |
| `/maintenance/:ref/quote-request`, `/quotes` | QuoteRequestPage, QuoteComparePage | Network quotes (Humo Contractor) | Request, compare, award | **"Message through Humo" and email invites are toasts** (F-16) | Impl., not verified | P3 |
| `/suppliers`, `/:id` | SuppliersPage, SupplierPage | Supplier register and vetting | Create, edit, status, request documents, change bank details (step-up), endorse | — | Impl., not verified | P2 |

## Communications and documents

| Route | Component | Purpose | Implemented | Missing | Status | Priority |
|---|---|---|---|---|---|---|
| `/communications/notices` | NoticesPage | Notices to residents | Publish, pin, withdraw | — | Impl., not verified | P2 |
| `/communications/compose` | ComposePage | Bulk messages | Audience, template, channels, preview, schedule | No real delivery provider | Verified (sim): Checkpoint 10 | P2 |
| `/communications/sent`, `/:id` | SentPage, SentMessagePage | Delivery log | Retry, cancel scheduled | Statement re-send from the account isn't recorded here (F-15) | Verified (sim): Checkpoint 10 | P2 |
| `/communications/templates` | TemplatesPage | Message templates | Create, edit, archive | Editing not tested | Impl., not verified | P3 |
| `/documents`, `/:docId` | LibraryPage, DocumentPage | Document library | Upload (file kept only for the browser session), edit, archive, visibility, expiry | Files aren't persisted; no virus scanning or size enforcement server-side | Impl., not verified | P2 |
| `/settings/documents` | DocumentsSettingsPage | Templates and branding | Default template per type, branding (step-up) | — | Impl., not verified | P2 |

## Governance and compliance

| Route | Component | Purpose | Implemented | Missing | Status | Priority |
|---|---|---|---|---|---|---|
| `/governance/meetings`, `/:id`, `/notice`, `/minutes` | MeetingsPage, MeetingPage, MeetingDocumentPage | Meeting lifecycle | Agenda, notice period, pack, attendance and quorum, minutes, resolutions, actions | — | Impl., not verified (this audit) | P2 |
| `/governance/resolutions` | ResolutionsPage | Resolutions register | Written resolutions via Approvals | — | Impl., not verified | P2 |
| `/governance/trustees`, `/:schemeId` | TrusteesPage, BoardPage | Trustee boards | Add (elect or co-opt), end term, portfolio, minimum | Board ≠ trustee access (F-06); no invite from the board (F-27) | Verified (sim): Checkpoint 10 | P1 (F-06 decision) |
| `/governance/rules`, `/breaches/:id` | RulesPage, BreachPage | Rules register and breach log | Add, amend, repeal by resolution, share with owners, warnings, refer, resolve | — | Verified (sim): Checkpoint 10 | P3 |
| `/compliance`, `/:itemId` | CompliancePage, ComplianceItemPage | Generated compliance | Matrix, item pages, record, upload, manual items | False overdue for onboarding schemes (F-12) | Verified (sim) W4 (finding) | P1 |
| `/reports`, `/:reportId` | ReportsPage, ReportPage | 13 reports | Run, print, CSV | — | Impl., not verified | P3 |

## Settings

| Route | Component | Implemented | Status |
|---|---|---|---|
| `/settings/profile` | My profile, preferences | Impl., not verified |
| `/settings/agency` | Agency details, trust accounts (step-up), compliance profile | Verified (sim) W8 (read-only view) |
| `/settings/notifications` | Notification rules | Impl., not verified |
| `/settings/billing` | Billing configuration, financial years | Impl., not verified |
| `/settings/plan` | Plan and upgrade requests | Impl., not verified |
| `/settings/system` | Maintenance banner, upload limit, session and retention policy (Humo staff only) | Impl., not verified |

## Resident portal (`/my/*`)

| Route | Purpose | Status | Notes |
|---|---|---|---|
| `/my/home`, `/my/account`, `/my/statements/:period` | Owner home, account, statements | Verified (sim) W7 | Uses the same statement component as staff |
| `/my/requests`, `/my/requests/new` | Resident requests | Impl., not verified | |
| `/my/documents`, `/my/notices` | Documents and notices visible to residents | Impl., not verified | Visibility is enforced in the mock (`library-store` `visible()`) |
| `/my/messages` | Message the managing agent | Verified (sim): Checkpoint 10 | |

## Humo platform (`/platform/*`, Humo staff)

| Route | Purpose | Status | Notes |
|---|---|---|---|
| `/platform/customers`, `/:orgId` | Customers, onboarding, subscription, invite first administrator | Verified (sim) W1 | F-21, F-22, F-23, F-24 |
| `/platform/accounts`, `/:view` | Account manager's book | Impl., not verified | |
| `/platform/executive`, `/:section` | Business overview | Impl., not verified | Figures are generated targets (`seed-platform` `TARGETS`) |
| `/platform/packages` | Packages and features | Impl., not verified | `docs/09`: no catalogue editing |
| `/platform/templates` | Humo document templates | Impl., not verified | |
| `/platform/flags`, `/:key` | Feature flags | Impl., not verified | |
| `/platform/health` | Platform health and incidents | Impl., not verified | Uptime and metrics are simulated |
| `/platform/team`, `/:id` | Humo team management | Verified (sim): the Humo team fix | |
| `/platform/users` | Users and impersonation | Verified (sim) W8 | |
| `/platform/audit` | Platform audit log | Verified (sim) | |

## Humo Contractor (`/contractor/*`, a separate product prototyped here)

`/contractor`, `/requests`, `/requests/:id`, `/jobs`, `/profile` are **Impl., not verified**. This is out of scope for Property Management's backend. Several bare "Humo" strings here are correct, because it's another product.

---

## Cross-cutting UI findings

| ID | Finding | Evidence | Priority |
|---|---|---|---|
| F-15 | **Inert actions presented as real:** "Re-send statement" (account) and "Email statement" (statement) only show a toast. Nothing is recorded in Communications › Sent, unlike the billing run's statement sending. | `account-page.ts:170`, `statement-page.ts:133` | P2 |
| F-16 | Network messaging and email invitations to quote are toasts saying "planned". | `quote-compare-page.ts:186`, `quote-request-page.ts:88` | P3 |
| F-31 | **Naming:** 133 candidate lines still use bare "Humo". Most are platform-level uses that doc 07 allows (Humo staff, Humo sign-in, Humo Contractor network), but they haven't been reviewed one by one. "Humo PM" appears in a form help text ("held outside Humo PM") where doc 07 prefers the full name. | Read-only naming scan | P3: review against doc 07 |
| F-24 | The breadcrumb shows a raw id on the platform customer page. | W1 | P3 |
| F-32 | **Patterns are consistent:** one form drawer, one data table, one record header, one confirmation idiom (forms with a reason, step-up for sensitive actions). Few duplicates observed. | Code | — (strength) |
| F-33 | **Dead code:** the `planned()` route helper and `features/planned/` are no longer used by any route. | `app.routes.ts:19` | P3: remove later |
| F-34 | **Stale docs:** `docs/09` §4 still lists billing, communications, governance and others as placeholders, and "no Humo staff role administration". | `docs/09-simulation.md` | P3 |
