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

## Progress

- [x] Checkpoint 1 — Shell, navigation, roles, design tokens
- [ ] Checkpoint 2 — Dashboard & Tasks
- [ ] Checkpoint 3 — Portfolio, Schemes, Units, People, Staff
- [ ] Checkpoint 4 — Finance
- [ ] Checkpoint 5 — Maintenance & Suppliers
- [ ] Checkpoint 6 — Communications & Documents
- [ ] Checkpoint 7 — Governance & Compliance
- [ ] Checkpoint 8 — Reports, Settings, Resident portal, Platform
