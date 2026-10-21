# Humo Property Management — UX Review after Checkpoint 1

> Reviewer stance: senior SaaS product designer. Date: 2026-10-06.
> Scope: everything in PR #1 — the information architecture (doc 01), the shell, navigation, roles, search, notifications and system states — plus the *plans* for each module expressed in the routes.
> Status: **ACCEPTED (2026-10-07).** All four decisions in §6 were approved and Checkpoint 2 (Foundations) implements them.
>
> | Decision | Outcome |
> |---|---|
> | Build order → vertical workflow slices (§4.2) | ✅ Accepted |
> | Scheme scope chip + pinned schemes | ✅ Accepted (reverses doc 01's "no global scope") |
> | Multi-role memberships + context switch | ✅ Accepted |
> | Revised navigation (§4.1), incl. My work and Suppliers under Maintenance | ✅ Accepted |
>
> Defects D-1 to D-7 (§5) are fixed in Checkpoint 2.

---

## 0. Headline verdict

The shell is solid: it is calm and consistent, role-aware, and the mobile split between staff and residents is right. But **the architecture is still module-first**. Every module is its own island of list → detail pages, and the planned screens mostly describe *entities* rather than *journeys*. If we build checkpoints 2–8 as planned (one module at a time), Humo will become a well-styled collection of CRUD screens — the exact outcome the brief warns against.

Three structural problems drive most of the findings below:

1. **No shared "work" model.** Tasks, approvals, badges, notifications and the dashboard's "Requires attention" are each separate things, so they will disagree with one another.
2. **No context model.** Nothing carries "I'm working on Kingfisher Court, Unit 42, Anele's account" as the user moves between modules. URLs and breadcrumbs reflect *where a page lives*, not *how the user got there or what it relates to*.
3. **No record pattern.** Every detail page (unit, person, job, supplier, meeting) will be designed separately unless we define one record page anatomy now.

The recommendation is to fix these with **eight reusable patterns** (section 3), then build in **vertical workflow slices** instead of module by module (section 4).

Severity key: **P0** fix before building more screens · **P1** fix in the slice that touches it · **P2** polish.

---

## 1. Findings by area

### 1.1 Navigation

**F1 — The sidebar is organised by department; the agent's day is organised by queues and schemes. (P0)**
- **What's wrong:** The daily work (allocate receipts, chase debtors, move maintenance along, reply to owners, approve invoices) is spread across five groups (Finance, Maintenance, Communications, Tasks, Compliance). The attention badges are also scattered: 17, 4, 8, 6, 7, and Tasks shows 12 on top of those.
- **Why it matters:** A portfolio manager opens the app 30+ times a day to clear queues. If every queue sits two clicks deep in a different group, the sidebar stops being a map and becomes a maze. It also says "Tasks: 12" while showing 42 other actionable items elsewhere, so the user can't trust either number.
- **Recommend:** A **"My work"** section at the top of the sidebar with Tasks · Approvals · Inbox, and *one* number on each, all derived from a single Attention model (F2). Module groups stay below for browsing and reference.
- **Ripple:** Changes the Dashboard (it becomes a summary of My work), notifications and every badge. Inbox moves from Communications to My work.

**F2 — Approvals live in three places. (P0)**
- **What's wrong:** A quote can be approved under Tasks › Approvals, Maintenance › Quotes & approvals, and (as an invoice) Finance › Supplier invoices.
- **Why it matters:** Approvers, especially trustees, will not know where to look. The same item will also show different states in different places.
- **Recommend:** One **Approval engine**, with one approval record type. It covers quotes, supplier invoices, payment batches, billing runs, budget sign-off and written trustee resolutions. All approvals are actioned in Approvals; module pages *show* approval status in context and deep-link into it.
- **Ripple:** Removes "Quotes & approvals" as a page. Quotes become a tab on the job. Finance › Supplier invoices shows status only.

**F3 — The collapsed sidebar sends group clicks to the first child. (P2)**
- Clicking Finance in the icon rail opens Levies & billing, which is rarely what the user wants. Show a **flyout** listing the group's items instead.

**F4 — Breadcrumbs link to pages the user can't open. (P1)**
- A trustee on "Portfolio › **Schemes** › Kingfisher Court" gets a role-denied redirect when clicking "Schemes". Crumbs should only link where the role has access.

### 1.2 Information architecture

**F5 — "Statements" is a nav item but not a place the user goes. (P1)**
- **What's wrong:** A statement is an *output*: of a billing run (bulk) and of an account (single). Making it a top-level list invites a CRUD "Statements" table.
- **Recommend:** Remove it from the nav. Statements live on the **Account** (view, download, email) and in the **Billing run** final step (generate and send all). Keep the route for deep links.

**F6 — There is no outgoing payment step. (P0 for the procure-to-pay slice)**
- **What's wrong:** The brief's chain ends "Invoice → Payment", but Finance has no place to pay suppliers: no payment batch, no proof of payment, no "paid" state.
- **Recommend:** Rename **Supplier invoices → Payables**, covering invoices to approve, invoices approved for payment, payment batches (with dual authorisation via the Approval engine), and remittances.

**F7 — Reports appear twice. (P2)** "Financial reports" (Finance) and "Reports" (top-level) will overlap. Use **one report catalogue** with categories (Financial · Arrears · Maintenance · Governance · Portfolio) and a scheme scope. Finance links into the Financial category.

**F8 — Units and People are global lists, but agents almost always work *within* a scheme. (P1)**
- Keep the global lists for search and cross-scheme work. Make the **scheme workspace** the primary home of units and people, and make it reachable in one click via pinned schemes (F10).

### 1.3 Dashboard usefulness

**F9 — The dashboard plan is metric-led, not action-led. (P0)**
- **What's wrong:** The planned dashboard opens with portfolio totals (24 schemes, 1 284 units). An agent already knows how many schemes they manage. The question at 08:00 is "what will hurt me today if I don't act?"
- **Recommend:**
  1. **Today:** due/overdue work from the Attention model, grouped by urgency rather than module, each item one click from resolution.
  2. **Exceptions:** things that changed since yesterday (new arrears over 90 days, quotes received, failed debit orders, compliance items that became overdue).
  3. **Portfolio health:** a *scheme health table* (one row per scheme with collections %, arrears, open jobs, compliance status), sortable, which tells the agent which scheme needs them.
  4. Totals go in a single, small summary strip.
- **Role variants:** Finance leads with unallocated receipts, debtors and payables. Portfolio managers see only their schemes. Agency admins add team workload. Trustees get a single-scheme health view plus their approvals.
- **Ripple:** The dashboard can only be honest once the Attention model and scheme health metrics exist, so build it **after** the first workflow slices, not as checkpoint 2.

### 1.4 Scheme navigation

**F10 — There is no persistent scheme context. (P0)**
- **What's wrong:** In doc 01 I recommended against a global scheme scope. Having seen the shell, that was wrong for this domain. A portfolio manager works "on Kingfisher Court" for an hour at a time, then switches. Today, leaving the scheme workspace for Finance › Debtors drops the scheme, and the user has to filter again.
- **Recommend:** A **scope model** with three parts:
  - **Pinned / My schemes** listed in the sidebar under the "Schemes" item (portfolio managers see their assigned schemes automatically).
  - A **scope chip** in the topbar ("All schemes ▾" / "Kingfisher Court ✕"). Every portfolio-wide module respects it, and it is remembered per session.
  - The **scheme workspace tabs** reuse the same module components with the scope applied (this keeps D3 from doc 01).
- **Ripple:** Every list, search, report and "+ New" form reads the scope. "+ New maintenance request" pre-fills the scheme.

### 1.5 Unit → Owner → Account relationships

**F11 — The URL structure loses context mid-journey. (P0)**
- **What's wrong:** `/schemes/kc/units/42` is nested, but the owner is `/people/:id` and the account is `/finance/statements/:accountId`. Following Scheme → Unit → Owner → Account → Statement jumps the user across three sections. The breadcrumb changes from "Portfolio › Schemes › Kingfisher Court › Unit 42" to "Portfolio › People › Anele Mthembu" to "Finance › Statement", and the chain is lost.
- **Why it matters:** This is the most common journey in the product (an owner phones about their balance).
- **Recommend:**
  - The **account belongs under the unit**: `/schemes/:s/units/:u/account` and `/…/account/statements/:period`. This is consistent with D2 (the account follows the unit).
  - A person keeps one canonical page (`/people/:id`) because they may own several units. That page has a **relationship header** listing "Owner · KC 42 (R 4 812.50 arrears) · Trustee · Kingfisher Court", each a link.
  - A **Relationship chain** component on every record page shows the entity's real parents from data, e.g. `Kingfisher Court › Unit 42 › Anele Mthembu (owner) › Account KC-042`. Every part is clickable, and the chain doesn't depend on how the user arrived.
  - A **Preview drawer**: clicking an owner on the unit page opens the person in a side drawer (balance, contact details, quick actions) without leaving the unit. "Open full page" is available when needed.
- **Ripple:** Defines the Record page anatomy (pattern P1) for every module.

**F12 — The persona model contradicts decision D1. (P0)**
- **What's wrong:** D1 says one person can hold many roles, but `Persona.role` is a single value. In practice Sipho is a *trustee and an owner*. Resident pages also assume one unit per owner (`unitLabel`).
- **Recommend:** A user has **memberships** (role + scope): e.g. `[{trustee, Kingfisher Court}, {owner, KC 12}]`. The account menu offers a **context switch** ("Trustee · Kingfisher Court" / "Owner · Unit 12"). Owners with several units get a unit switcher in the resident portal.
- **Ripple:** Session, nav filtering, guards and the resident portal. This is cheap now and very expensive after 8 checkpoints.

### 1.6 Finance workflows

**F13 — Debtors is planned as an ageing table; credit control is a process. (P1)**
- **Recommend:** Each account in arrears has a **collection stage**: Reminder → Final demand → Letter of demand → Handed over, with *Payment arrangement* and *Disputed* as side states. Each stage has a next action, a due date and a document template. The Debtors screen is a **pipeline/queue**, where ageing is a filter and a chart rather than the whole page. Bulk "send reminder to all 30-day accounts in scope" uses the Compose pattern (P7).
- **Ripple:** Reuses the Workflow-status pattern (P3), Compose (P7) and Timeline (P4). Arrangements create Tasks.

**F14 — Receipt allocation must be a focused, keyboard-fast workspace. (P1)**
- Use a split view: unallocated receipts on the left; suggested matches on the right (by reference, amount and payer history), each with a confidence level and a reason ("Reference KC042 matches account KC-042"). Add a **"Remember this payer"** rule. Split allocation across units. A suspense account handles unknown receipts. Success state: "All receipts allocated", with no dead end.

**F15 — The billing run needs explicit exception handling and reversibility. (P1)**
- Steps: Scope → Period → Charges preview → **Exceptions** (no owner, levy changed, account on hold, interest overrides) → Approval (Approval engine) → Generate & send statements. Once posted, the run is **locked**. Corrections are journal adjustments, not edits. The UI must state this clearly before approval.

### 1.7 Maintenance workflows

**F16 — Request, quotes, supplier, invoice and payment are planned as five separate places. (P0)**
- **Recommend:** A single **Job** record is the spine of the whole chain:

  ```
  Request (resident/staff) ─▶ Job ─▶ Quotes (1..n, compare) ─▶ Approval ─▶ Work order to supplier
       ─▶ Scheduled / In progress ─▶ Completed (photos) ─▶ Verified ─▶ Invoice matched ─▶ Paid ─▶ Closed
  ```
  - The Job page has a **stage tracker** (P3) at the top, a **timeline** (P4) of every event, quote, message, photo and invoice, and **next-action** buttons that change with the stage.
  - Supplier invoices are **matched** to the job and its approved quote. A variance between quoted and invoiced amounts is flagged, and paying above the approved amount needs re-approval.
  - Finance › Payables, Suppliers › Supplier › Jobs and Approvals are **views of the same records**, not copies.
- **Ripple:** Defines the procure-to-pay data shape the .NET domain will need (Job, Quote, Approval, WorkOrder, SupplierInvoice, Payment). This is a strong argument for building it as an early vertical slice.
- **API, 20 Oct 2026 (slice 3a):** the job is on the API from report to close:
  - reports from staff, residents (their own unit) and the Inbox, each waiting in My work for triage;
  - quotes, then approval: within the agency's delegated authority (R5 000), or by the trustees in My work above it;
  - the work order, start, completion, the resident's confirmation (or staff confirming on their behalf), and the supplier's invoice;
  - an invoice above the approved quote, or with no quote, goes back for approval;
  - one invoice number per supplier; comments and cancelling (not once invoiced).
  - **Still to come:** paying invoices in batches with two approvers (slice 3b), and quotes from the Humo Contractor network.

**F17 — Residents report problems but the follow-up loop is missing. (P1)**
- Residents need: status updates pushed to them, a "Was this fixed?" confirmation that feeds *Verified*, and the ability to add photos later. Common-property issues must avoid duplicates ("3 residents have reported the gate motor" → *add yourself*).

### 1.8 Supplier workflows

**F18 — The supplier plan lacks vetting and compliance. (P1)**
- SA managing agents vet suppliers: COIDA letter of good standing, public liability insurance, tax clearance, B-BBEE certificate, bank confirmation letter. Expiry of these should (a) block new work orders or warn about them, and (b) feed Compliance automatically (F24).
- The Supplier page uses the Record pattern: Overview (services, schemes, rating) · Jobs · Quotes · Invoices & payments (a ledger) · Documents (with expiry) · Performance (on-time %, quote-vs-invoice variance, resident verification rate).
- Changing a supplier's bank details is a fraud vector and needs a **verification step** with approval.
- **API, 20 Oct 2026 (slice 3a):** suppliers, their documents and their status are on the API:
  - a supplier with a missing or expired document (other than B-BBEE) gets a work order only when the person issuing it overrides the warning, and the job records that;
  - suppliers on hold or archived, or not serving the scheme, can't be given work;
  - changing bank details needs a fresh passkey and leaves the account unverified until it's confirmed.

### 1.9 Communication workflows

**F19 — Communication is planned as a destination; it should be a capability. (P0)**
- **What's wrong:** Communications is a top-level module with an inbox, announcements and history. But most messages are sent *from* a context: a reminder from Debtors, a water-outage notice from a Job, an AGM notice from a Meeting.
- **Recommend:**
  - A **Compose pattern** (P7): an audience builder (scheme, block, units, owners, tenants, trustees, arrears filter), channels (email · SMS · WhatsApp · portal notice), templates with merge fields, preview per recipient, and a schedule. It opens *in context*, pre-filled.
  - A **Timeline** (P4) on every record shows the communication linked to it, so "did we tell them?" is answered on the unit, the job or the meeting.
  - The Communications module becomes **Inbox (in My work), Sent, Templates**. Announcements is just Compose with the audience set to "whole scheme".
  - Each message shows delivery status (sent · delivered · opened · failed). Owners and tenants can opt out of channels; statutory notices can't be opted out of (wording only — no legal logic yet).
- **Ripple:** Every module gets a "Notify…" action through the same component.

### 1.10 Document management

**F20 — The library is the right *view*, but documents should be born in context. (P1)**
- **Recommend:** An **Attachments panel** (P5) on every record (job, meeting, supplier, unit, scheme). Anything uploaded there appears in the library with its links already set. The library is a *search over all attachments*, with facets.
- Each document has: category, related records (many), date, uploaded by, **visibility** (Staff · Trustees · Owners of this scheme · This unit only), and optionally an **expiry** (which feeds Compliance).
- Resident view = documents published to them. Trustee view = trustee-visible documents.

### 1.11 Governance

**F21 — Action items from meetings aren't connected to the work queue. (P0)**
- **What's wrong:** The plan is Meeting → Resolution → Action → Assigned person → Status, but actions aren't Tasks, so they will rot in a resolutions register nobody opens.
- **Recommend:**
  - **Actions are Tasks** (the Attention model) with a back-link to the resolution and meeting. Completing the task completes the action, and that shows on the resolution.
  - Meetings use a **lifecycle** (P3): Draft agenda → Notice sent → Pack ready → Held → Minutes draft → Minutes approved. Each stage has the right actions (send notice via Compose, build the pack from Documents, record attendance, capture resolutions in the meeting itself).
  - **Written (round-robin) trustee resolutions** outside meetings use the Approval engine.
  - AGM-specific links: the budget for approval comes from Budgets, trustee elections update Trustee boards, and proxies and quorum are captured on the meeting (UI only).
- **Ripple:** The resolutions register is a *view* over resolutions with filters, not a separate data entry place.

### 1.12 Compliance

**F22 — Compliance is planned as a manual list. (P1)**
- **Recommend:** Compliance items are mostly **generated by other modules**:
  - insurance expiry from documents
  - the AGM due date from the last AGM date
  - supplier documents expiring
  - the CSOS return due date from the scheme's financial year
  - trustee documentation from board records
  
  The Compliance page is a **matrix**: schemes × compliance types, with status cells (Complete · Due soon · Overdue · N/A). It also has a calendar, and each cell drills into the source record. Manual items remain possible.
- Keep the wording neutral ("Due soon", "Overdue") and make no claims of legal sufficiency.

### 1.13 Role-based experiences

**F23 — Trustees currently see agency-wide notifications and badges. (P0 — defect)**
- **What's wrong:** In the build, the trustee's bell shows notifications for The Willows and Jacaranda Heights, and nav badges show agency totals ("4 invoices awaiting approval"). This leaks other bodies corporate's information. That is a privacy and trust problem in any real deployment.
- **Recommend:** Every count and notification is computed **from the Attention model, filtered by the user's memberships** (F12). There are no hard-coded badge numbers in the nav config.

**F24 — Roles differ in navigation only, not in experience. (P1)**
- Finance users see the same Portfolio-first sidebar as portfolio managers. Finance's home should be Receipts, Debtors and Payables. Trustees should have a read-mostly experience with approvals front and centre. Agency admins need team workload.
- The System Administrator's agency switcher changes nothing visible. It needs a purpose: **"View as agency (support mode)"**, with a clear banner and an audit note.
- Owners currently have *no* notifications. Residents need them (payment received, job updated, new notice) or the portal has no reason to be opened.

### 1.14 Search

**F25 — Search covers pages and schemes only. (P1)**
- Agents search by **things they hear on the phone**: unit codes ("KC 42", "kingfisher 42"), owner names, phone numbers, account numbers, payment references, job numbers ("MR-1042"), supplier names, invoice numbers.
- **Recommend:**
  - **One search index** across entity types, with results grouped by type and showing a key fact (balance, status). Results open the Preview drawer on Enter, or the full page on Ctrl+Enter.
  - **Recent items** shown when the query is empty.
  - **Actions** in search ("allocate receipt", "log request for KC 42").
  - It respects the scope chip, with a "search all schemes" toggle.

### 1.15 Filtering

**F26 — There is no filtering standard yet. (P0 before the first table)**
- **Recommend:** One **Data table pattern** (P2) that includes:
  - a filter bar with chips, and URL-synced state, so links share the exact view
  - **saved views** ("My 90+ day debtors")
  - column choice, sorting, bulk selection with a sticky bulk-action bar, and totals rows for money columns
  - respect for the scope chip
  - on mobile, rows become cards with one or two key facts

### 1.16 Notifications

**F27 — Notifications and tasks aren't distinguished. (P1)**
- A *notification* tells you something happened ("quote received"). A *task* asks you to do something ("approve quote"). Both come from the same event, but they must not double-count.
- **Recommend:** Notifications are events, grouped ("3 receipts allocated automatically") and linked to the record. Personal preferences cover channel and digest ("Daily 07:30 summary").
- On mobile, notifications use Ionic toasts and push in later phases.

### 1.17 Empty states

**F28 — One generic empty state can't serve three different situations. (P1)**
- **First use:** "No units yet" → *Import units from CSV* / *Add unit*. This is onboarding, so it should be generous.
- **Filtered to nothing:** "No debtors match these filters" → *Clear filters*. Keep it small and inline.
- **Done:** "All receipts allocated" → show what was achieved and what's next. This is the reward state for queues.
- Make it one `ui-empty-state` component with `kind: 'first-use' | 'filtered' | 'done'`, plus copy guidelines.

### 1.18 Error states

**F29 — Errors are all-or-nothing, and some are silent. (P1, two defects P0)**
- **Defect:** An unknown scheme (`/schemes/does-not-exist`) renders a page titled "Scheme" with no error. The resolver swallows the miss.
- **Defect:** When search can't load schemes, it says "No pages or schemes match". That is wrong information, not an error.
- **Defect-ish:** A role-denied URL bounces the user home with a toast and loses what they were trying to open. Show an **in-place "You don't have access"** page that names who can grant access.
- **Recommend:**
  - **Partial errors:** one dashboard widget failing shows an inline retry while the rest of the page works.
  - **Record not found** pages with search.
  - **Form errors:** field-level messages plus a summary at the top.
  - **Conflict errors:** "This invoice was approved by Priya at 09:14 — refresh."
  - **Offline banner** on mobile.

### 1.19 Loading states

**F30 — One skeleton for every page. (P2)**
- Skeletons should **mirror the real layout** (the table skeleton matches its columns; the record page skeleton matches its header and tabs).
- On refetch or filter changes, **keep stale data visible** with a slim progress bar, instead of blanking to a skeleton.
- Actions show inline pending states (button spinner, optimistic row update).
- *Simulated latency* stays in the prototype toolbar.

### 1.20 Mobile responsiveness

**F31 — Staff on mobile get the whole desktop menu in a drawer. (P1)**
- Staff use phones *on site*: walking a scheme, meeting a contractor, approving a quote between meetings.
- **Recommend a staff "field mode"** on phones:
  - bottom tabs: My work · Jobs · Search · Inbox · More
  - quick capture: photo → new job with unit/area
  - approvals with swipe-free, explicit buttons
  - read-only finance summaries
  - complex screens (billing run, budgets, reports) show a "best on desktop" message plus their key read-only facts
- **Topbar at 375px** is crowded: hamburger, context, search, action, bell and avatar. Move search and the action into the tab bar, and keep the context and avatar.
- Note: in the browser tool's mobile emulation, taps did not reach the page, so touch behaviour has not been verified yet. Test on a real device or a simulator before sign-off.

---

## 2. Is Humo PM becoming CRUD?

Today: **at risk, not yet**. Every planned route is either a *list* or a *detail*, and each module owns its own lists. The three journeys in the brief cut across four or five modules each. Under the current plan, each journey would be stitched together with links between unrelated pages.

The test for every screen from now on: **"What is the next action, and can I take it here?"** If the answer is "go to another module", the screen is wrong.

---

## 3. Reusable patterns (build once, use everywhere)

| # | Pattern | What it is | Used by |
|---|---|---|---|
| **P1** | **Record page** | Header (identity, key facts, status, primary actions) · Relationship chain · Tabs · Right rail with Timeline. Same anatomy for every entity. | Scheme, Unit, Person, Account, Job, Supplier, Meeting, Resolution, Billing run |
| **P2** | **Data table** | Filter chips, URL state, saved views, scope-aware, bulk-action bar, money totals, mobile card mode, row → Preview drawer | Every list |
| **P3** | **Workflow tracker** | Stage bar + current stage + "next action" buttons + stage history; one definition per workflow | Job, Billing run, Collection stage, Meeting lifecycle, Compliance item, Approval |
| **P4** | **Timeline** | Chronological events, comments, messages, documents and status changes on a record, filterable | All records |
| **P5** | **Attachments panel** | Upload in context, set category/visibility/expiry, appears in the library | All records; feeds Documents & Compliance |
| **P6** | **Approval engine UI** | Approval card (what, amount, budget impact, evidence), approve/reject with comment, approver rules, history | Quotes, invoices, payment batches, billing runs, budgets, written resolutions |
| **P7** | **Compose** | Audience builder, channels, templates with merge fields, preview, schedule, delivery status | Announcements, reminders, AGM notices, job updates |
| **P8** | **Attention model** | Every actionable item is a *work item* (type, record, scope, due, assignee, urgency). Drives Tasks, Approvals, badges, Dashboard "Today", notifications | Whole app |

Supporting patterns:
- **Scope** (scheme context chip + pinned schemes)
- **Preview drawer**
- **Relationship chain**
- **Money** (formatting, ledger table, balance with arrears colouring)
- **Typed empty, error and loading states**
- **Wizard** (billing run, onboarding a scheme, AGM pack)

These map cleanly to the future backend. The Attention model, Approval engine, Timeline and Attachments are cross-cutting **application services** in Clean Architecture terms. Defining their UI contracts now gives the .NET work a clear shape.

---

## 4. Proposed changes

### 4.1 Revised navigation (staff)

```
My work         Tasks · Approvals · Inbox                 ← one number each, from P8
Dashboard
Schemes         [pinned / my schemes listed here]         ← scope entry point
Portfolio       Units · People · Staff
Finance         Billing · Receipts · Credit control · Payables · Budgets
Maintenance     Jobs · Suppliers                          ← Suppliers joins the job spine
Communications  Sent · Templates                          ← Compose is an action everywhere
Documents
Governance      Meetings · Resolutions & actions · Trustee boards · Rules
Compliance
Reports         (one catalogue, incl. financial)
Settings
```

Changes from the accepted doc-01 navigation:
- My work added (Tasks, Approvals and Inbox move there).
- Pinned schemes added.
- Statements removed from the nav (F5).
- Supplier invoices becomes Payables, with payments (F6).
- Debtors becomes Credit control (F13).
- Quotes & approvals is removed (F2).
- **Suppliers moves under Maintenance.** This reverses the doc-01 decision. Reason: the job spine makes suppliers primarily a maintenance concern, and Payables covers the finance side. *This needs your call.*
- Financial reports merges into Reports (F7).

### 4.2 Build order: vertical slices instead of modules

| New checkpoint | Delivers | Patterns introduced |
|---|---|---|
| **2. Foundations** | Attention model, Scope + pinned schemes, multi-role memberships, Record page, Data table, Preview drawer, typed states; fix defects F23 and F29 | P1, P2, P8, Scope, states |
| **3. Slice A: "Owner calls about their balance"** | Scheme → Unit → Owner → Account → Statement, plus receipts allocation | Relationship chain, Money, Timeline (P4) |
| **4. Slice B: "Fix the leaking geyser"** | Request → Job → Quotes → Approval → Work order → Invoice → Payment; Suppliers | P3, P5, P6 |
| **5. Slice C: "Run the trustee meeting"** | Meeting → Resolution → Action (Task) → Completion; AGM foundation | P3 reused, P7 |
| **6. Credit control & Billing run** | Collection pipeline, bulk Compose, billing wizard | P7, Wizard |
| **7. Dashboard, Compliance & Documents** | Dashboard built on real P8 data; generated compliance matrix; library | — |
| **8. Roles & mobile** | Finance/Trustee/Admin homes, resident portal, staff field mode, Reports, Settings, Platform | — |

Why: each slice proves a whole journey end to end, and each one adds patterns the next slice reuses. The dashboard comes late because it is a *summary of everything else* and would be fiction if built first.

---

## 5. Defects found in the current build

| # | Defect | Severity |
|---|---|---|
| D-1 | Trustee sees notifications for other schemes and agency-wide badge counts | P0 |
| D-2 | Unknown scheme ID renders a "Scheme" page instead of "not found" | P0 |
| D-3 | Search shows "no matches" when the scheme data failed to load | P1 |
| D-4 | Role-denied URLs redirect home and lose the destination | P1 |
| D-5 | Breadcrumb links lead to pages the role can't open | P1 |
| D-6 | The System Administrator's agency switcher has no visible effect | P2 |
| D-7 | Nav badge counts are hard-coded in config | P1 (resolved by P8) |

---

## 6. Decisions requested

1. **Build order:** switch to the vertical-slice order in 4.2?
2. **Scheme scope:** adopt the scope chip + pinned schemes (reversing doc 01's "no global scope")?
3. **Multi-role users:** adopt memberships + context switch (F12)?
4. **Navigation:** adopt 4.1, including moving Suppliers under Maintenance and Inbox into My work?
