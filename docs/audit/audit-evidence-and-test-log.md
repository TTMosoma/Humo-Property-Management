# Audit evidence and test log

Audit of the Humo Property Management frontend, 9–10 October 2026, on branch `feature/identity-access` at commit `edb67df`.

**Audit only.** No application source, styles, configuration, dependencies, routes or mock data were changed during the audit. The only files written are these documents under `docs/audit/`.

**Side effects to be aware of:**
- `ng build` overwrote the generated `dist/` folder, which git ignores.
- The browser workflows (section 3) created records in **this browser's simulated data** (localStorage): one agency, one invited administrator, one scheme, one unit, one person, one maintenance job, and one impersonation session. The simulation was **not** reset.

## 1. Commands run

| # | Command (in `frontend/humo-web`) | Result | Evidence |
|---|---|---|---|
| C1 | `npm test` (`ng test`) | **Failed:** `Cannot determine project or target for command.` | `angular.json` defines only `build` and `serve`. `tsconfig.spec.json` expects `vitest/globals`, but there's no test target and no test runner dependency. |
| C2 | `find src -name '*.spec.ts'` | **0 files** | There are no unit, component or e2e tests. |
| C3 | `npx tsc -p tsconfig.app.json --noEmit` | **Passed** (exit 0) | Strict mode, `strictTemplates`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature` are on. |
| C4 | `npx prettier --check "src/**/*.{ts,html,scss}"` (read-only) | **385 of 452 files** don't match the repo's `.prettierrc` | `.prettierrc` exists and `prettier` is a dev dependency, but there's no format script or check. |
| C5 | `npx ng build` (production) | **Passed with 1 warning:** initial bundle **1.36 MB** against a 1.20 MB warning budget (2 MB error). 145+ lazy chunks. | Build output, 10 Oct 2026. |
| C6 | Lint | **Not available.** No ESLint configuration or `lint` target. | `angular.json`, `package.json` |
| C7 | Dev server (`humo-web`, port 4310) | Running. Template type errors are reported here; `tsc` misses them. | Two such errors were caught and fixed during the Humo team work (`edb67df`), before the audit started. |

**Toolchain:** Node 24.18.0 · Angular 22.2.1 (core, CLI) · TypeScript 6.0.3 · Ionic Angular 8.8.19 · RxJS 7.8.2 · npm 11.16.0.

## 2. Files and areas inspected

| Area | Files |
|---|---|
| Configuration | `package.json`, `angular.json`, `tsconfig*.json`, `.prettierrc`, `.gitignore`, `src/app/app.config.ts` |
| Routing | `src/app/app.routes.ts` (843 lines; parsed into a route table, see the screen matrix) |
| Navigation | `core/navigation/nav.config.ts` |
| Guards and session | `core/access/access.guard.ts`, `core/access/signed-in.guard.ts`, `core/session/session.service.ts`, `features/schemes/scheme.resolver.ts`, `core/scope/scope.service.ts` |
| Data access | `domain/ports/*.ts` (40 abstract data sources), `mock/provide-mock-data.ts`, `mock/data-sources/*.ts` |
| Mock "server" | `mock/server/mock-gateway.ts`, `mock/server/mock-auth-session.ts` |
| Mock stores | `mock/db/*.ts` (22 persisted stores, seeds), `mock/simulation/simulation-storage.ts`, `mock/fixtures/*.ts` |
| Domain models | `domain/models/*.ts` (42 files) |
| Documents | `features/documents/**`, `docs/document-pdf-rendering-standard.md`, `docs/document-template-architecture.md` |
| Existing documentation | `README.md`, `docs/01`–`16`, document template docs |

**Search patterns used** (all read-only):
- `HttpClient` and interceptors: none found.
- Feature code importing `mock/`: none found.
- `feedback.info(` stubs: 6 found, 4 of them inert.
- `planned(`: only the helper's definition remains.
- `toISOString().slice(0, 10)`: 17 uses.
- `portfolioManagerOf(` with seed data: 10 callers.
- `simulationStorage` keys: 22.
- A scan for bare "Humo" in UI strings: 133 candidate lines.

## 3. Browser workflows executed (built-in browser, dev server, 10 Oct 2026)

Full write-up: [workflow-test-results.md](workflow-test-results.md).

| ID | Workflow | Persona | Result |
|---|---|---|---|
| W1 | Onboard an agency and invite its first administrator | Nomsa (Humo System Administrator) | **Pass**, with 3 findings |
| W2 | Create a scheme and a unit | Thandeka (Agency Administrator) | **Pass**, with 2 findings |
| W3 | Add an owner and link them to the unit | Thandeka | **Pass**, with 2 findings |
| W4 | Rename the scheme and check other screens | Thandeka | **Pass** (the name propagated). Found false "overdue" compliance Tasks on the new scheme. |
| W5 | Log a maintenance request and inspect the job | Thandeka | **Partial:** created at triage. The lifecycle couldn't progress (no supplier serves the new scheme) and wasn't re-run. |
| W6 | Compare the account balance with the statement (KC-042, Oct 2026) | Thandeka | **Pass:** R 4 812.50 on both |
| W7 | Role and scope visibility | Johan (Portfolio Manager), Anele (Owner) | **Pass for the owner. Finding for the Portfolio Manager:** he can open any scheme in the agency. |
| W8 | Entitlement gating, and impersonation in Observe mode | Terry observing as Annette (Fynbos, Essentials) | **Pass** |

**Tested earlier in this same working session** (before the audit, so not re-run):
- **Checkpoint 10:** budgets (draft, AGM proposal, approval by resolution), trustee boards (co-opt, end term, compliance item), scheme rules (amend, share), breach log (warning letter recorded in Sent), Sent retry, resident messages.
- **Humo team:** invite, two-person System Administrator approval, offboarding with customer reassignment, audit entries.

These are recorded in `docs/15` and `docs/16`. They count as evidence from this session, not from the audit pass.

**Not tested in this audit:**
- Checkpoints 1–9 flows beyond W1–W8, including billing run posting, receipt allocation, credit-control letters, meetings and resolutions, reports, settings and feature flags. Earlier checkpoint docs report browser testing at the time; that wasn't re-established here.
- Phone layouts, screen readers, keyboard-only navigation, and colour contrast measurement.
- Printing and PDF output. The statement was inspected as HTML on screen only.
- Concurrency (409) across two browsers. The simulation is per browser.

## 4. Limitations

- **There is no backend.** Every behaviour observed is the in-memory simulation; "works" means "works in the simulation".
- **Seeds use relative dates.** Seed data is generated relative to "today" and then saved per store. What a screen shows depends on the day each store was first seeded in the browser.
- **The route table was extracted with a read-only script.** A few rows were duplicated by the parser's look-ahead; the component and permission columns were checked by hand against `app.routes.ts`.
- **Small browser pane** (about 791×470 CSS px). Some controls were operated through the accessibility tree or direct DOM events. Where a scripted input failed, it was retried with real typing before anything was concluded.
  - The W5 unit picker "failure" was an artefact of my scripting, not an application defect.
  - The W6 "missing bank name" was a text-extraction artefact: the name is present.
