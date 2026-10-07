# Humo Property Management

**One platform. Every scheme. Everything managed.**
The operating system for community-scheme management.

## Repository layout

| Path | What |
|---|---|
| `frontend/humo-web` | Angular 22 + Ionic 8 UI prototype (mock data, no backend) |
| `backend/` | .NET Clean Architecture API — *later phase* |
| `docs/` | Information architecture and product decisions |

## Run the prototype

```bash
npm --prefix frontend/humo-web install
npm --prefix frontend/humo-web start -- --port 4310
```

Open http://localhost:4310. (Port 4200 is avoided because Docker Desktop commonly holds it.)

Use the dashed **Prototype** button (bottom-right) to:
- view the app as any of the 7 roles
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
5. As Priya, choose **Release EFT batch**. The job moves to *Paid*, and Johan closes it.

Other things to try:
- **MR-1042** (roof): approve it as a trustee in Approvals and the job moves to *Approved — issue work order*.
- **Log request**: logging a new request takes you through triage, quotes and approval. Quotes up to **R 5 000** can be approved under delegated authority (an assumption to confirm).
- **Tenant (Ruan)**: answer “Was it fixed?” for MR-1033, then use **Report a problem**. The request lands in the team’s triage queue.
- **Suppliers**: Bright Spark’s expired liability insurance is flagged, and a work order for them needs an explicit override.

## Progress

Build order follows workflow slices (see `docs/02-ux-review.md` §4.2).

- [x] Checkpoint 1 — Shell, navigation, roles, design tokens
- [x] Checkpoint 2 — Foundations: brand, Attention model (Tasks, Approvals, live badges), scheme scope and pinned schemes, multi-role memberships, record page, data table, preview drawer, typed empty/error/loading states, schemes list and scheme workspace
- [x] Checkpoint 3 — Slice A: Owner calls about their balance (Scheme → Unit → Owner → Account → Statement, receipts, people, owner portal account)
- [x] Checkpoint 4 — Slice B: Fix the leaking geyser (Job → Quote → Approval → Work order → Verification → Invoice → Payment, suppliers, resident requests)
- [ ] Checkpoint 5 — Slice C: Run the trustee meeting (Meeting → Resolution → Action → Completion)
- [ ] Checkpoint 6 — Credit control & billing run
- [ ] Checkpoint 7 — Dashboard, Compliance & Documents
- [ ] Checkpoint 8 — Role homes, resident portal, staff mobile, Reports, Settings, Platform
