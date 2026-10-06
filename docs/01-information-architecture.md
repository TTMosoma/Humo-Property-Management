# Humo Property Management — Information Architecture & Shell (Proposal v0.1)

> Status: **PROPOSAL — partially accepted (2026-10-06).** Nothing in this document is implemented yet.
>
> | Decision | Outcome |
> |---|---|
> | D1 Unified People + roles | ✅ Accepted |
> | Visual direction: Ink + deep teal | ✅ Accepted |
> | Repo: `/frontend/humo-web`, `/backend` later, git initialised | ✅ Accepted |
> | Refined navigation (section 2) | ✅ Accepted with changes: **Staff stays under Portfolio**, **Compliance is top-level** |
> Phase: UI-first prototype. No backend, no EF Core, no auth infrastructure.

---

## 1. Core mental model

```
Agency (tenant of Humo)
 └── Scheme  (body corporate / HOA / share block)
      └── Unit  (section / erf / share block)
           ├── Ownership  → Person (owner)      → Levy account
           └── Occupancy  → Person (tenant)
      ├── Trustee board → Person (trustee, with portfolio e.g. Chairperson)
      ├── Finance  (levy schedule, billing runs, receipts, invoices, budget)
      ├── Maintenance (requests → jobs → quotes → invoices)
      ├── Governance (meetings, resolutions, rules, compliance)
      └── Documents & Communications (attached to any of the above)
```

### Decision D1 — "Person + role", not separate Owner/Tenant/Trustee records
One human is frequently an owner of Unit 12, a trustee of the same scheme, and a tenant somewhere else.
The UI will treat **People** as one directory, with **roles derived from relationships**
(ownership, occupancy, trustee appointment). Owner/Tenant/Trustee lists are *filtered views* of People.

*Why it matters:* this decision flows directly into the future domain model (a `Person` aggregate with
relationship entities, not three duplicated tables). Better to validate it in the UI now.

### Decision D2 — Account belongs to the Unit's ownership, not the Person
The levy account is `Scheme → Unit → Account`, and the current owner is the account holder.
When a unit transfers, the account history stays with the unit. The Unit page shows this chain visually:

```
Kingfisher Court  ›  Unit 42  ›  Owner: T. Mokoena  ›  Account 42-KC  (R 4 812.50 in arrears)
```

---

## 2. Navigation — refined structure

The original brief listed a nav with some overlap (Trustees in two places, Billing vs Levies,
Requests vs Jobs, Suppliers under Maintenance but also Creditors under Finance, Documents split per category).
I propose the following, organised around **jobs**, not tables:

| Section | Items | Job to be done |
|---|---|---|
| **Home** | Dashboard | "What needs my attention today?" |
| **Tasks** *(new)* | My tasks, Team tasks, Approvals | One work queue for everything actionable (overdue jobs, invoices to approve, debtors to follow up). The dashboard's "Requires attention" links into this. |
| **Portfolio** | Schemes, Units, People (Owners · Tenants · Trustees tabs), Staff | "Find a scheme/unit/person/team member and understand its state and workload." |
| **Finance** | Levies & billing, Receipts & allocation, Statements, Debtors, Supplier invoices, Budgets, Financial reports | "Bill correctly, get every rand allocated, chase arrears, pay suppliers, report." |
| **Maintenance** | Requests (list + board), Quotes & approvals, History | "Take a problem from reported → resolved." |
| **Suppliers** | Directory, Performance | Shared by Maintenance (jobs/quotes) and Finance (invoices/payments) so it gets its own top-level item. |
| **Communications** | Inbox, Announcements & notices, Sent history, Templates | "Tell the right people the right thing, and prove that we did." |
| **Documents** | Library (faceted) | "Find the right document for the right scheme quickly." One library with facets (scheme, category, date, related entity, uploader) instead of six sub-pages. |
| **Governance** | Meetings (incl. AGM/SGM as meeting types), Resolutions & actions, Trustee boards, Scheme rules | "Run meetings and track what was decided." |
| **Compliance** | Compliance overview (all schemes), Calendar, Items | "Know what is due, overdue or complete across every scheme." |
| **Reports** | Report catalogue | Portfolio & scheme reports. |
| **Settings** | Agency profile, Users & access (logins, roles, permissions), Notifications, Billing configuration, System | Staff *profiles & scheme assignments* live in Portfolio › Staff; Settings only handles login access and permissions. |

Merges proposed:
- **Billing + Levies → "Levies & billing"** (levy schedules + billing runs are one job).
- **Requests + Jobs → one Maintenance Request** that progresses through stages; "jobs" is the board view.
- **Maintenance History → filter** (status = closed), not a page.
- **Announcements + Notices → one area**, "notice" is a formal announcement type.
- **AGM/SGM → meeting types** inside Meetings (with an AGM-specific checklist).
- **Trustees** appears once (Governance › Trustee boards); People › Trustees is a filtered view of the same data.
- **Compliance** is top-level (not inside Governance) because it spans insurance, finance and statutory items, not only governance.

### Decision D3 — Portfolio-wide modules **and** a Scheme workspace, sharing the same components
- Global modules (e.g. Finance › Debtors) show **all schemes** with a scheme filter.
- The **Scheme workspace** (`/schemes/:id/...`) has its own tabs (Overview, Units, People, Finance, Maintenance,
  Suppliers, Documents, Communications, Meetings, Compliance, Reports) that **reuse the exact same feature
  components, pre-scoped to the scheme**.
- Result: one Debtors screen, two entry points. No duplicate pages, consistent behaviour.

---

## 3. Application shell

```
┌──────────────┬──────────────────────────────────────────────────────────────────┐
│ HUMO         │  [Agency ▾]   [ Search or jump to…   Ctrl K ]   [+ New ▾]  🔔  ? (TM)│
│              ├──────────────────────────────────────────────────────────────────┤
│ Home         │  Portfolio › Kingfisher Court › Unit 42                          │
│ Tasks     12 │                                                                  │
│              │  Page header: title · key status · primary actions               │
│ PORTFOLIO    │  ─────────────────────────────────────────────                   │
│  Schemes     │  Tabs (when inside a workspace)                                  │
│  Units       │                                                                  │
│  People      │  Content                                    ┌──────────────────┐ │
│ FINANCE      │                                             │ Preview drawer   │ │
│  …           │                                             │ (row click opens │ │
│ MAINTENANCE  │                                             │  details without │ │
│ …            │                                             │  losing the list)│ │
│              │                                             └──────────────────┘ │
│ ⚙ Settings   │                                                                  │
└──────────────┴──────────────────────────────────────────────────────────────────┘
```

Shell elements:
- **Sidebar** — grouped, collapsible to icons; items filtered by role/permission.
- **Agency switcher** — for System Administrators and users who work for more than one agency.
- **Command palette (Ctrl K)** — jump to any scheme, unit (“KC 42”), person, supplier, or action.
- **"+ New" quick actions** — log maintenance request, allocate receipt, send notice, upload document, schedule meeting.
- **Notifications** — panel with links to the relevant record.
- **Preview drawer** — click a row and see its details in a side panel, then open the full page if needed. This matters most in debtors, receipts and maintenance work.
- **Breadcrumbs** always show the Agency → Scheme → Unit → Person chain.

### Mobile behaviour
- **Staff (< 768px):** sidebar becomes an Ionic slide-out menu. Dashboard, Tasks, Maintenance and Notifications are designed for mobile first. Complex finance screens (billing run, reports) stay desktop-first and show a simplified read-only layout on mobile.
- **Owners & tenants:** a bottom tab bar (Ionic tabs): *Home · Account · Requests · Documents · More*. It works like a native app because these users will mostly be on their phones.

---

## 4. Roles → navigation

One app and one shell. Navigation and permissions change with the role.

| Area | Sys Admin | Agency Admin | Portfolio Mgr | Finance | Trustee | Owner | Tenant |
|---|---|---|---|---|---|---|---|
| Platform (agencies, plans, health) | ✔ | | | | | | |
| Dashboard (portfolio) | | ✔ | ✔ (assigned schemes) | ✔ (finance focus) | scheme dashboard | "My home" | "My home" |
| Tasks / Approvals | | ✔ | ✔ | ✔ | approvals only | | |
| Portfolio | | ✔ | ✔ | read | own scheme, read | | |
| Finance | | ✔ | read + debtors | ✔ | read + approve invoices | own account & statements | |
| Maintenance | | ✔ | ✔ | read | read + approve quotes | log & track own | log & track own |
| Suppliers | | ✔ | ✔ | ✔ | read | | |
| Communications | | ✔ | ✔ | ✔ | scheme notices | notices + messages | notices + messages |
| Documents | | ✔ | ✔ | ✔ | scheme docs | own unit + public scheme docs | public scheme docs |
| Governance | | ✔ | ✔ | read | ✔ (meetings, resolutions) | AGM notices & minutes | |
| Compliance | | ✔ | ✔ | read | own scheme, read | | |
| Reports | | ✔ | ✔ | ✔ | scheme reports | | |
| Settings | platform | ✔ | profile only | profile only | profile only | profile only | profile only |

Trustees get an **approvals** experience (quotes and supplier invoices), because in practice trustees authorise spend.

Owner/tenant routes live under `/my/...` (e.g. `/my/account`, `/my/requests`). They use the same shell with a different nav.
System Admin routes live under `/platform/...`.

---

## 5. Route map (prototype)

```
/dashboard
/tasks                         /tasks/approvals
/schemes                       /schemes/:schemeId/{overview|units|people|finance|maintenance|suppliers|documents|communications|meetings|compliance|reports}
/schemes/:schemeId/units/:unitId
/people                        /people/:personId           (?role=owner|tenant|trustee)
/staff                         /staff/:staffId
/finance/billing               /finance/billing/new (wizard)   /finance/billing/:runId
/finance/receipts              (unallocated → allocate flow)
/finance/statements            /finance/statements/:accountId
/finance/debtors               /finance/supplier-invoices   /finance/budgets   /finance/reports
/maintenance                   /maintenance/new             /maintenance/:requestId
/suppliers                     /suppliers/:supplierId
/communications                /communications/compose      /communications/history   /communications/templates
/documents
/governance/meetings           /governance/meetings/:meetingId
/governance/resolutions        /governance/trustees         /governance/rules
/compliance                    /compliance/:itemId
/reports                       /reports/:reportId
/settings/{agency|users|roles|notifications|billing|system}
/my/{home|account|statements|requests|documents|notices}
/platform/{agencies|plans|health}
```

---

## 6. Prototype-only tooling (removable)

- **Persona switcher:** a floating "Prototype" control that switches between the 7 roles in one click, so every role-based experience can be reviewed.
- **State simulator:** forces the current page into *loading / empty / error* so those states can be reviewed without special data.
- Mock latency (≈300–600 ms) so loading skeletons are actually seen.

---

## 7. Frontend technical direction (proposal)

- **Angular 22**: standalone components, signals, new control flow, zoneless change detection, lazy-loaded feature routes.
- **Ionic 8 (standalone)**: used *selectively* for the mobile menu, owner/tenant tab bar, bottom sheets, action sheets, pull-to-refresh and toasts. It is **not** used for the dense desktop staff screens.
- **Custom design system** (SCSS + CSS custom-property tokens), no Angular Material. This avoids the "generic admin template / accounting app" look. Angular CDK is used for overlays, focus management and accessibility.
- **Charts:** small hand-built SVG components (bar, stacked aging bar, budget-vs-actual, sparkline, donut). They have no heavy dependency and fit the visual language.
- **Mock data layer shaped like future ports:** each feature depends on an abstract data-access class (e.g. `SchemeDataSource`), and the prototype provides an in-memory implementation. Later, an HTTP implementation calling the .NET API replaces it with a one-line provider change, and no component changes. This mirrors the Clean Architecture boundary you'll build on the backend.

### Folder layout
```
/frontend/humo-web          ← Angular + Ionic prototype (this phase)
/backend                    ← .NET Clean Architecture (later phase)
/docs                       ← IA, decisions, flows

frontend/humo-web/src/app/
  core/        shell, layout, navigation config, persona/session (mock), prototype tools
  ui/          design system: buttons, tables, badges, stat tiles, charts, drawer, empty/error/skeleton states
  domain/      TypeScript models + data-source contracts (no Angular deps where possible)
  mock/        fixtures + in-memory data sources
  features/    dashboard, tasks, portfolio, schemes, units, people, finance, maintenance,
               suppliers, communications, documents, governance, reports, settings, my (portal), platform
```

---

## 8. Design language (proposal)

- **Tone:** calm and credible. Mostly neutral surfaces, a deep ink/teal primary, and colour used for *meaning* (status, risk) rather than decoration.
- **Typography:** Inter with tabular figures for every monetary column. Use a clear type scale with strong page titles and small-caps section labels.
- **Shape:** 6px radius, 1px hairline borders and sections divided by rules instead of card-on-card. Minimal shadows, used only on overlays.
- **Data:** right-aligned Rands in `R 12 345.67` format (SA spacing). Status pills come in a small consistent set (Complete / Due soon / Overdue / N/A; Open / In progress / …).
- Light theme first, with a dark theme supported through tokens.

---

## 9. Mock data universe

Agencies, all fictional:
- **Acacia Managing Agents** (Johannesburg) is the main demo agency. It has 24 schemes, ~1 284 units and 9 staff.
- Two smaller agencies (Cape Town, Durban) exist so the System Admin view and agency switching can be shown.
- Tshikrand is **not** hard-coded anywhere. It would be onboarded as just another agency record.

Schemes are a mix of sectional title body corporates, HOAs and one share block, across Gauteng, Western Cape and KZN.
They come with realistic levies (R 1 450 – R 6 900 pm), SA phone numbers and addresses, mock CSOS references, and suppliers such as plumbers, electricians, security, garden services, pest control and lift maintenance.

---

## 10. Build sequence (unchanged from brief, with review checkpoints)

1. Shell + navigation + persona switcher + design tokens → **checkpoint**
2. Dashboard + Tasks → **checkpoint**
3. Portfolio, Scheme workspace, Unit profile, People → **checkpoint**
4. Finance (billing run wizard, receipts allocation, statements, debtors, supplier invoices, budgets, reports) → **checkpoint**
5. Maintenance + Suppliers → **checkpoint**
6. Communications + Documents → **checkpoint**
7. Governance + Compliance → **checkpoint**
8. Reports, Settings, Owner/Tenant portal, Platform admin → **final review**
