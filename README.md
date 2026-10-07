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

## Progress

Build order follows workflow slices (see `docs/02-ux-review.md` §4.2).

- [x] Checkpoint 1 — Shell, navigation, roles, design tokens
- [x] Checkpoint 2 — Foundations: brand, Attention model (Tasks, Approvals, live badges), scheme scope and pinned schemes, multi-role memberships, record page, data table, preview drawer, typed empty/error/loading states, schemes list and scheme workspace
- [ ] Checkpoint 3 — Slice A: Owner calls about their balance (Scheme → Unit → Owner → Account → Statement, receipts)
- [ ] Checkpoint 4 — Slice B: Fix the leaking geyser (Job → Quote → Approval → Invoice → Payment, suppliers)
- [ ] Checkpoint 5 — Slice C: Run the trustee meeting (Meeting → Resolution → Action → Completion)
- [ ] Checkpoint 6 — Credit control & billing run
- [ ] Checkpoint 7 — Dashboard, Compliance & Documents
- [ ] Checkpoint 8 — Role homes, resident portal, staff mobile, Reports, Settings, Platform
