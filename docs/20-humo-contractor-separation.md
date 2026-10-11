# 20 · Humo Contractor as a separate application

**Date:** 11 October 2026 (branch `refactor/separate-humo-contractor`).

**What changed:**
- Humo Contractor is no longer inside the Humo Property Management app. Its portal, routes, role and demo personas were removed from Humo PM.
- Humo Contractor is now its own Angular application in the same workspace: `frontend/humo-web/projects/humo-contractor`. It's a **minimal foundation**: one landing screen and nothing else.

The goal was a clean product boundary, so the Humo PM demo shows only Humo PM. No Contractor features were built.

## 1. Two applications, one workspace

```
frontend/humo-web/                  Angular workspace (one package.json, one node_modules)
├── src/                            Humo Property Management   (project "humo-web")
└── projects/humo-contractor/src/   Humo Contractor            (project "humo-contractor")
```

**Why one workspace and not two repositories:**
- Angular supports several applications in a workspace.
- Each application gets its own entry point, configuration, routes, build target and output folder.
- They share only the installed packages. Nothing in either app imports the other.
- A separate repository would mean a second dependency install, duplicated tooling and an extra CI pipeline, for an app that is a single page today. It can still be moved out later without code changes, because the code is already separate.

| | Humo Property Management | Humo Contractor |
|---|---|---|
| Angular project | `humo-web` | `humo-contractor` |
| Source | `frontend/humo-web/src` | `frontend/humo-web/projects/humo-contractor/src` |
| Run (dev) | `npm start` → http://localhost:4310 * | `npm run start:contractor` → http://localhost:4320 |
| Build | `npm run build` (demo: `npm run build:demo`) | `npm run build:contractor` |
| Output | `dist/humo-web/browser` | `dist/humo-contractor/browser` |
| Tech | Angular 22 + Ionic 8, mock data layer | Angular 22 only (no Ionic yet; add it when screens need it) |

\* `npm start` alone serves on Angular's default port 4200. The Claude preview and the README add `-- --port 4310`.

**All commands run from `frontend/humo-web`:**
```bash
npm install                  # once, for both apps
npm start -- --port 4310     # Humo PM
npm run start:contractor     # Humo Contractor
npm run build                # Humo PM
npm run build:contractor     # Humo Contractor
```

Every script names its project explicitly (`ng serve humo-web`, `ng build humo-contractor`). Neither app needs the other to run or build.

## 2. Removed from Humo PM

| Removed | Why |
|---|---|
| `features/contractor-portal/` (shell, dashboard, quote request, profile) and the `/contractor` routes; the `/supplier` redirect | The Contractor product experience |
| `ContractorPortal` port, `InMemoryContractorPortal`, and the portal-only types (`ContractorDashboard`, `ContractorRequestView`, `QuoteSubmission`, `WorkOrder`) | Only the portal used them |
| Seeded work orders, and quote requests from other agencies (QR-2038, QR-2044, QR-2046) | Only the contractor dashboard showed them |
| Role `supplier` ("Contractor / Supplier"), permission `Contractor.Respond`, scope type `party`, role family `supplier` and its `--role-supplier` colour token | These are Humo Contractor users; Humo PM doesn't sign them in |
| Demo personas Themba Khoza (SecureAccess) and Kevin Pillay (Rand Plumbing) | Contractor users |
| Contractor branding on the sign-in page (`?product=contractor`), the contractor title rule, and the contractor branch in the sign-in guard | The PM sign-in is for Humo PM |
| The contractor's view of quote messages | It lived in the portal |

The simulation's saved-data version was bumped to `SCHEMA = 3`. Browsers that saved demo data before this change (including visitors to `pm-demo.humo.co.za`) start again from the seed data, so no stored contractor persona or role survives.

## 3. Kept in Humo PM, on purpose

Contractors as a **business entity** stay: they're part of property management.

| Kept | Why |
|---|---|
| Suppliers (list, supplier page, vetting documents, banking, performance, payables, supplier payments) | Core Humo PM |
| **Request quotes**, **Compare quotes**, messages to contractors, email invites (`features/maintenance/quotes`) | Humo PM's maintenance workflow. It *uses* the Humo Contractor network through the `ContractorNetwork` port, as one product consuming another. |
| "On Humo Contractor" panel and **Endorse** on the supplier page | PM shows a supplier's Humo-wide profile |
| `domain/contractor/` (models + `ContractorNetwork` port), `mock/contractor/` (network store and seed), `features/contractor-shared/` (verification badge, reputation, endorsements) | What PM needs to consume the network. They don't depend on PM. |
| The "Contractors" plan feature (contractor performance and scheduling) | A PM entitlement |
| `HUMO_PRODUCTS.contractor` in `core/product/product.ts` | The Humo product registry (brand architecture), not navigation |
| "Humo Contractor" integration on Platform health | Humo staff monitor the link to the other product |
| `contractor-quote` document type | A planned PM document: the approved quote |

## 4. Intentionally shared

- **npm packages:** one `package.json` and `node_modules` for the workspace.
- **TypeScript base settings:** `frontend/humo-web/tsconfig.json`. Both apps extend it, so both get the strict and unused-code checks.
- **Brand files:** Humo Contractor has its own *copies* in `projects/humo-contractor/public/` (wordmark, mark, favicon, touch icon).
- **Design tokens:** the Humo brand colours and fonts are *copied* into `projects/humo-contractor/src/styles.scss`, not imported from Humo PM.

Copying keeps the apps independent. Move the tokens and brand files to a shared package when both products need more of them.

**Not shared:** code, routes, configuration, sign-in, data layer, mock data, APIs. There's no cross-application communication.

## 5. The Contractor foundation

`projects/humo-contractor/src`:
- `main.ts`, `app/app.config.ts` (router only), `app/app.routes.ts` (`''` → landing, `**` → `''`), `app/app.ts` (router outlet);
- `app/landing/landing-page.ts`: a navy top bar with the Humo wordmark and a "Contractor" tag, the name **Humo Contractor**, one neutral sentence, and "The platform foundation is being prepared". No features are listed or implied.

**When development starts**, decide first:
- whether it keeps this workspace or moves to its own repository;
- whether it adds Ionic and the shared design system;
- how it uses the one Humo sign-in (D5);
- which parts of `domain/contractor` it takes ownership of.

## 6. Remaining "contractor" references in Humo PM

| Reference | Status |
|---|---|
| `domain/contractor/*`, `mock/contractor/*`, `features/contractor-shared/*` | **Intentional:** PM consumes the contractor network (quote requests, profiles, endorsements) |
| `features/maintenance/quotes/*`, `job-next-step`, supplier pages: "Humo Contractor" wording | **Intentional:** names the other product PM works with |
| `core/product/product.ts` `contractor` entry | **Intentional:** the Humo product registry |
| Entitlement `contractors`, document type `contractor-quote`, ops integration "Humo Contractor" | **Intentional:** PM features and platform monitoring |
| `docs/05-humo-contractor.md`, `docs/audit/*` | **History:** dated design and audit records. `docs/05` has a note pointing here; the audits are snapshots and are left as written. |
