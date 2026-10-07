# Humo Property Management

**One platform. Every scheme. Everything managed.**
The operating system for community-scheme management, built for professional managing agents.

## Humo and its products

**Humo** is the product family and platform: one Humo identity, security, audit, notifications, billing and subscriptions, and the Humo company behind them. **This repository is one Humo product: Humo Property Management** ("Humo PM" where space is short).

```
Humo — property technology platform
├── Humo Property Management   ← this application
├── Humo Valuations            (future, separate product)
├── Humo Contractor            (future, separate product; its portal is prototyped here at /contractor
│                               behind its own shell to prove the boundary)
└── future Humo products
```

**Keep the layers apart:**

| Layer | Example |
|---|---|
| Product family | Humo |
| Application | Humo Property Management |
| Organisation | Tshikrand |
| User | Sarah Jacobs |
| Role | Portfolio Manager |
| Scope | Oakwood Estate |
| Package | Humo Professional |
| Feature entitlement | Governance |

**Naming rules:**
- Say "Humo Property Management" (or "Humo PM") for this application, e.g. "the Humo PM dashboard" or "Humo PM Finance". Avoid a bare "Humo" for things that belong to this app.
- Keep "Humo" for genuinely platform-level things: Humo System Administrator, Humo Account Manager, Humo Support and Humo Executive, the Humo identity, Humo security, Humo Mobile, and the Humo platform.
- Humo Valuations and Humo Contractor are never modules in Humo PM's navigation. A future product switcher would sit outside each application, reading `core/product/product.ts`.

See `docs/07-brand-architecture.md`.

## Repository layout

| Path | What |
|---|---|
| `frontend/humo-web` | Angular 22 + Ionic 8 UI prototype (mock data, no backend) |
| `backend/` | .NET Clean Architecture API — *later phase*, planned as `Humo.PropertyManagement.*` (`.Api`, `.Application`, `.Domain`, `.Infrastructure`), leaving room for `Humo.Valuations.*` and `Humo.Contractor.*` |
| `docs/` | Information architecture and product decisions |

## Run the prototype

```bash
npm --prefix frontend/humo-web install
npm --prefix frontend/humo-web start -- --port 4310
```

Open http://localhost:4310. (Port 4200 is avoided because Docker Desktop commonly holds it.)

Use the dashed **Prototype** button (bottom-right) to:
- sign in as any demo identity (and switch role from your name in the top bar)
- force pages into *loading / empty / error* states
- turn simulated network latency on or off

## Frontend structure (`frontend/humo-web/src/app`)

| Folder | Responsibility |
|---|---|
| `domain/` | TypeScript models and **ports**: abstract data sources the UI depends on |
| `mock/` | Fixtures and in-memory implementations of the ports (swap for HTTP later) |
| `core/` | Shell, navigation, session, role access, prototype tools |
| `ui/` | Design system: tokens are in `src/styles/_tokens.scss`, components here |
| `features/` | Feature screens, lazy-loaded per route |

## Brand

Colours, type and imagery come from the Humo logo (originals in `Logo/`):

| Token | Value | Use |
|---|---|---|
| Navy | `#041B40` | Primary actions, sidebar, headings |
| Leaf | `#54BE8D` → `#6CD3A0` | Accent, active states, positive values |
| Cream | `#F2F0E4` | Wordmark and text on navy |
| Type | Outfit (display) · DM Sans (text, tabular figures) | |

Generated assets in `frontend/humo-web/public/brand/`:
- transparent logo, wordmark and mark (light and reversed)
- PWA icons and favicon from the "o + leaf" mark

In-app imagery is drawn as code, so it follows the theme:
- spot illustrations: `ui/illustration/illustration.ts`
- per-scheme architectural artwork: `ui/illustration/scheme-art.ts`

## Demo: “An owner calls about their balance” (Slice A)

1. As **Agency Administrator**, press **Ctrl K** and type `KC 42`, `kingfisher 42`, `mthembu` or `082 418`.
2. **Unit 42** shows the chain Scheme › Unit › Owner › Account, the R 4 812.50 balance, open work and the timeline. Log the call in **Activity**.
3. Open **Account & statements**:
   - “Why the balance is R 4 812.50” breaks down the charges.
   - A banner says a R 3 480.00 payment with reference “ANELE M” is waiting.
4. **Allocate** it from the banner. The balance drops to R 1 332.50, which is the special levy plus water she didn't know about. The ledger, timeline, Receipts and badges all update. The confirmation offers Undo.
5. Or work the queue in **Finance › Receipts**:
   - suggestions come with reasons
   - ↑/↓ moves between receipts and **Enter** accepts the top match
   - you can split, remember a payer, or move a receipt to suspense
6. Switch to **Owner (Anele)**. **My account** shows the same numbers, how to pay, and statements for both of her units.

All data is generated in `mock/db/` (1 284 units, owners, tenants, trustees, six-month ledgers and bank receipts). It is consistent across screens and resets on reload.

## Demo: “Fix the leaking geyser” (Slice B)

1. As **Portfolio Manager (Johan)**, open **Maintenance › Jobs** in list or board view, then **MR-1012**.
   - The tracker shows the job stuck at *Booked*.
   - **Next step** says the plumber missed the 1 October booking and gives his number.
2. Work the job through **Supplier is on site → Record completion → Confirmed fixed → Capture invoice**. The invoice is matched to the approved quote automatically.
3. As **Finance (Priya)**, open **Finance › Payables › Ready to pay**, select the invoice and choose **Create payment batch**.
4. As **Trustee (Sipho)**, approve the batch in **Approvals**. This is the second authoriser.
5. As Priya, choose **Verify and release EFT batch** and confirm with a passkey or Humo Mobile (step-up). The job moves to *Paid*, and Johan closes it.

Other things to try:
- **MR-1042** (roof): approve it as a trustee in Approvals and the job moves to *Approved — issue work order*.
- **Log request**: logging a new request takes you through triage, quotes and approval. Quotes up to **R 5 000** can be approved under delegated authority (an assumption to confirm).
- **Tenant (Ruan)**: answer “Was it fixed?” for MR-1033, then use **Report a problem**. The request lands in the team’s triage queue.
- **Suppliers**: Bright Spark’s expired liability insurance is flagged, and a work order for them needs an explicit override.

## Demo: identity, roles and impersonation

The model is described in `docs/03-identity-access.md`.

1. In the prototype panel, sign in as **Sarah Jacobs**: one identity with four roles. Click her name in the top bar and choose **Switch role → Finance User**.
   - Navigation, queues and scope change.
   - A strip confirms "You're now working as Finance User"; she is still signed in as Sarah.
2. Switch to **Agency Administrator**, then open **Settings › Users & access**.
   - Give **Johan** the Trustee role for The Willows. This asks for step-up; choose **Approve in Humo Mobile** to see number matching.
   - Open Sarah's own row: she can't change her own roles.
3. Open **Settings › Roles & permissions**: the access model, the role catalogue, the permission matrix and the plan.
4. Open **Settings › Audit log**: the role switches, the grant and the step-up are recorded. **Humo access** lists every time Humo staff impersonated someone in the agency.
5. Sign in as **Terry Mosoma** (Humo System Administrator). Open **Platform › Users & impersonation**, then **View as… Sarah Jacobs**.
   - Choose **Portfolio Manager**, **Observe** and a reason, tick the acknowledgement, and start.
   - The orange banner and frame make impersonation unmistakable, and actions disappear.
   - **Exit impersonation** returns you to Terry.
6. Impersonate **Priya** in **Act** mode. This needs a case reference, a note and a passkey. Approve PB-0412 in **Approvals**, exit, then open **Platform › Audit log › Impersonation**: it shows *Terry Mosoma as Priya Naidoo · Approved payment batch · R 58 940.20*.
7. Sign in as **Lerato** (Humo Support). She can find users but has no **View as…**, because impersonation is an individual grant.

## Demo: the Humo platform (packages, health, nudges)

The model is described in `docs/04-platform-commercial.md`.

1. Sign in as **Nomsa Khoza** (Humo Executive). **Business overview** shows MRR, ARR, customers, schemes, units, active users and retention, plus the revenue, growth, health, adoption and expansion panels. It is read-only.
2. Sign in as **Dumisani Ngcobo** (Humo Account Manager). **My accounts** lists customer requests and slipping accounts, then conversations worth having. Open **Tshikrand**:
   - health 87, with each signal explained
   - adoption by module
   - Governance **HIGH** (8 trustees, 14 meetings a year) and Advanced Reporting **MEDIUM**
3. As **Sarah** (Portfolio Manager, Acacia), open **Tasks**. A Smart Nudge suggests Governance, based on Acacia's own usage. Choose **Explore Governance**, switch role to **Agency Administrator**, and choose **Ask Humo about Governance**.
4. Back as Dumisani, open **Customers › Acacia › Subscription & features › Manage features**. Give a reason, add the **Governance** add-on, and verify.
5. As Sarah again: **Governance** now appears in the navigation, and the nudge has retired.
6. Sign in as **Lerato** (Humo Support): no MRR, no subscription controls, no executive view.

To see a nudge again, use **Prototype › Reset Smart Nudges**. Nudges follow their frequency rules, so a nudge that was shown once won't reappear for 30 days.

## Demo: Humo Contractor foundation (not a marketplace)

The design is described in `docs/05-humo-contractor.md`.

1. As **Johan**, open **MR-1070 — Replace damaged entrance gate**. Its Next step shows the Humo quote request **QR-2041**. Choose **Compare quotes**:
   - a workflow stepper
   - who was invited and who declined
   - ABC Gates R 38 500, XYZ Security R 42 000, SecureAccess R 35 900, side by side: price, timing, proposed work, reputation, endorsements, response time and compliance
   - SecureAccess's contact details hidden ("New to you")
2. **Accept & send for approval** on SecureAccess. Then:
   - **Sipho** approves it in Approvals.
   - Johan issues the work order. The bank letter needs an override, because SecureAccess is a new supplier.
3. Sign in as **Themba Khoza** (SecureAccess). **Humo Contractor** has its own look:
   - dashboard: 3 open requests, 5 active jobs, 28 completed, 4.8 rating, 12 endorsements, Verified
   - the gate quote shows **Accepted**
   - the job shows **Scheduled**
   - quote on Tshikrand's **boom gate** request
   - open **Profile** to see the verification levels and endorsements
4. In Humo PM, open **Suppliers › PaintPro Gauteng** and choose **Endorse**. This is only possible because Acacia has completed work with them.
5. Open **MR-1061 — Request quotes through Humo** to create a new quote request from a reported job.

## Progress

Build order follows workflow slices (see `docs/02-ux-review.md` §4.2).

- [x] Checkpoint 1 — Shell, navigation, roles, design tokens
- [x] Checkpoint 2 — Foundations: brand, Attention model (Tasks, Approvals, live badges), scheme scope and pinned schemes, multi-role memberships, record page, data table, preview drawer, typed empty/error/loading states, schemes list and scheme workspace
- [x] Checkpoint 3 — Slice A: Owner calls about their balance (Scheme → Unit → Owner → Account → Statement, receipts, people, owner portal account)
- [x] Checkpoint 4 — Slice B: Fix the leaking geyser (Job → Quote → Approval → Work order → Verification → Invoice → Payment, suppliers, resident requests)
- [x] Identity & access — one identity with many roles, Switch role, permissions, scope by assignment, plan entitlements, step-up (passkey / Humo Mobile), impersonation (Observe/Act) and the audit log
- [x] Humo platform layer — internal roles, packages/add-ons/overrides → effective entitlements, Account Health, opportunities, Smart Nudges, Executive dashboard, Account Manager home, customer 360
- [x] Humo Contractor foundation — business party, contractor profile, verification, reputation, endorsements, quote requests with multiple quotes, side-by-side comparison, protected contact, lifecycle events, Contractor portal
- [x] Experience integration — role-specific homes (operational Dashboard, resident Home), context card, locked plan states with upgrade requests, red impersonation / amber step-up language, Executive and Account Manager navigation, audit filters, phone layouts (`docs/06-experience-review.md`)
- [ ] Checkpoint 5 — Slice C: Run the trustee meeting (Meeting → Resolution → Action → Completion)
- [ ] Checkpoint 6 — Credit control & billing run
- [ ] Checkpoint 7 — Dashboard, Compliance & Documents
- [ ] Checkpoint 8 — Role homes, resident portal, staff mobile, Reports, Settings, Platform
