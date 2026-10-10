# Phase 1 verification report: branch and integration readiness

**Date:** 10 October 2026.

**Scope:** verification and reporting only. No application code, configuration or Git history was changed, and PR #3 was not merged.

**Method:**
- commands run in `frontend/humo-web`;
- the running dev server (`ng serve`, port 4310) in the built-in browser, using the prototype personas;
- direct calls to the data-source layer from the browser console where a screen hides an action.

**Side effects:** the browser's simulated data (localStorage) now holds the verification records: Zinhle Readiness (`humo-38`), Kagiso Sithole activated (`humo-8`), and an agency invite for `sipho.crossover@humo.example`.

## 1. Branch and commit identity

| Item | Observed |
|---|---|
| Checked-out branch | `feature/identity-access` |
| HEAD | `cf906bf` (equal to `origin/feature/identity-access`) |
| `origin/main` | `cbfb4a0` "Initial commit". **No application** (`frontend/` absent). |
| Relationship | Merge base = `cbfb4a0`. The feature branch is **22 commits ahead, 0 behind**. |
| PR #3 | Open, not draft, `MERGEABLE`, merge state `CLEAN`; base `main`, head `feature/identity-access` @ `cf906bf`; **512 files, +77 520 / −0**; **0 status checks** (no CI); **no reviews** |
| Working tree | Clean apart from 2 untracked audit docs (`frontend-readiness-matrix.md`, `frontend-remediation-plan.md`) and this report |
| Related PRs | **#1** (`feature/checkpoint-1-app-shell` → `main`) and **#2** (`feature/slice-a-owner-balance` → `feature/checkpoint-1-app-shell`) are still **open**; all their commits are contained in PR #3 |

## 2. Build, lint and test outcomes

| Command | Exit | Outcome | Code failure or tooling failure? |
|---|---|---|---|
| `npm test` (`ng test`) | 1 | **Fail:** "Cannot determine project or target for command." | **Tooling:** `angular.json` has no `test` target; 0 `*.spec.ts` files exist. `tsconfig.spec.json` expects Vitest, but it isn't installed or configured. |
| `npx ng lint` | 1 | **Fail:** "Cannot find 'lint' target for the specified project" (suggests `ng add angular-eslint`) | **Tooling:** no linter configured |
| `npx tsc -p tsconfig.app.json --noEmit` | 0 | **Pass** | Strict mode and strict templates on |
| `npx ng build` (production) | 0 | **Pass with 1 warning:** initial bundle 1.36 MB against the 1.20 MB warning budget (2 MB error) | Code-level, non-blocking. Mostly the mock stores (§5). |

**Conclusion:** the code **compiles and builds**. Nothing is **tested or linted**, because the tooling is missing, not because tests fail.

## 3. Humo staff-management verification (live)

**Routes and code:**
- navigation entry `platform-team` (`core/navigation/nav.config.ts`);
- route `platform/team`, `platform/team/:identityId` (`app.routes.ts`, permission `Platform.View`);
- `TeamPage` (`features/platform/team/team-page.ts`) and `MemberPage` (`member-page.ts`);
- forms in `team-forms.ts`;
- port `HumoTeamDataSource` (`domain/ports/access-data-sources.ts`), implemented by `InMemoryHumoTeamDataSource` (`mock/data-sources/in-memory-humo-team-data-source.ts`);
- state in `AccessStore` and `HumoTeamStore` (`mock/db`, localStorage keys `humo.sim.access`, `humo.sim.humo-team`);
- every command through `MockGateway.command` (`mock/server/mock-gateway.ts`).

| # | Step | Persona | Expected | Observed | Status |
|---|---|---|---|---|---|
| S1 | Navigation entry | Terry (System Administrator) | "Humo team" in the sidebar | Present; leads to `/platform/team` | **Pass** |
| S2 | List internal staff | Terry | Humo staff only, with status tabs | Tabs Team, Invited, Suspended, Former; columns person, roles, customers, status, last active (`TeamPage.rows`) | **Pass** |
| S3 | Invite: valid | Terry | Invited identity created; step-up; audited | "Zinhle Readiness" (Support): passkey, then "Invitation sent." → `/platform/team/humo-38`, status **Invited** (`inviteMemberForm` → `invite()` → `AccessStore.addIdentity` + `grantRole`) | **Pass** |
| S4 | Invite: non-Humo domain refused | Terry | Field error | "Humo staff sign in with their @humo.example address." (`invite()` validate) | **Pass** |
| S5 | Invite: duplicate (case-insensitive) | Terry | Field error | "ZINHLE@humo.example" → "Someone already signs in with this email." | **Pass** |
| S6 | Validation before step-up | Terry | Invalid input rejected before the passkey prompt | The passkey prompt came **first**; the error only appeared afterwards (gateway order: `authorise` → `validate`) | **Fail** (UX; H-2) |
| S7 | Persistence after reload | Terry | New member still listed | After a full reload: "Team 7 · Invited 2", Zinhle listed as Invited | **Pass** (browser-local simulation only) |
| S8 | Role assignment | Terry, Nomsa | Only Humo roles; System Administrator needs a second System Administrator | Role list = the 4 `HUMO_ROLES`. Earlier in this session: Terry's request for Kagiso was refused for Terry, approved by Nomsa only after switching to her System Administrator role (`grant-role` → `HumoTeamStore.pending`, `approve-grant` check). **Not repeated in this pass.** | **Pass** (session evidence) |
| S9 | Activation (invitation accepted) | Terry | Invited → Active, passkey enrolled | Kagiso: **Invited → Active** through *Simulate: invitation accepted* (`MockPrototypeControls.acceptInvite`) | **Pass** (simulated acceptance) |
| S10 | Suspension | Terry | Active or Invited → Suspended; sessions end | Zinhle: **Suspended**; actions become Restore and Offboard (`apply` `suspend`) | **Pass** |
| S11 | **Restore a suspended invitee → Invited (P0-7b)** | Terry | Returns to **Invited** | **Active**, with **0 passkeys**, and the "Invited: they haven't signed in yet" banner gone. `apply` `restore` sets `status: 'active'` unconditionally (`in-memory-humo-team-data-source.ts` ≈ l. 310). | **Fail** (H-1) |
| S12 | Offboard | Terry, Nomsa | Roles end; deactivated; customers reassigned | Earlier in this session: Carla offboarded, 61 customers moved to Thabo. **Not repeated in this pass.** | **Pass** (session evidence) |
| S13 | Unauthorised Humo user can't manage | Lerato (Humo Support) | View only; commands refused server-side | No Invite button, no member actions. **Direct calls** `invite(...)` and `act('humo-38', restore)` → **REFUSED: "Role does not have this permission"** | **Pass** |
| S14 | Agency administrator can't reach or manage Humo staff | Thandeka (Agency Administrator) | No access; no Humo staff in agency lists; can't grant Humo roles | `/platform/team` → "You don't have access"; no menu entry; `/settings/users` lists 9 users, none Humo. **Direct call** `AccessDataSource.assign('p-lerato', system-admin)` → **REFUSED** | **Pass** |
| S15 | **Agency invites reject Humo addresses (P0-7a)** | Thandeka | Field error | `sipho.crossover@humo.example` invited as agency staff: passkey, then **"Invitation sent…"**, now listed in agency users. Validation refuses only an email that *already* belongs to a Humo identity (`in-memory-access-data-sources.ts:75`, `existing?.kind === 'humo'`). | **Fail** (H-3) |
| S16 | Audit | Terry | Each command recorded, including refusals | Platform audit lists invite, grant request, approval (and the refused attempt), offboard. Earlier in this session; refusals in S13 and S14 go through `MockGateway.audit(…, 'denied')`. | **Pass** (code + session evidence) |
| S17 | Real invitation delivery | — | Email sent; acceptance by the invitee | **No email**; acceptance is a prototype button | **Blocked** (D5 identity provider; out of scope) |

**Summary:**
- 13 Pass
- 3 Fail: S6 (UX), S11 and S15 (P0-7)
- 1 Blocked: S17

**The workflow exists and works in the simulation.** Permissions hold in the simulated server. **P0-7 is not met.**

## 4. Mock-state behaviour

**Every write tested changed simulated state that survived a reload:**
- invite, suspend, restore and activate (Humo team);
- the agency invite.

That state is **per browser** (localStorage, `mock/simulation/simulation-storage.ts`), **not shared** and **not server-backed**.

Across the application, all 92 drawer forms submit through a data source. Four actions only show a message and change nothing:
- `statement-page.ts:133`;
- `account-page.ts:170`;
- `quote-compare-page.ts:186`;
- `quote-request-page.ts:88`.

## 5. Prototype personas and mock data in production configuration

| Check | Observed | Status |
|---|---|---|
| Data layer wiring | `app.config.ts` calls `provideMockData()` unconditionally. It provides the in-memory data sources **and** `PrototypeControls` (`mock/provide-mock-data.ts`). | **Fail** for production |
| Environment configuration | No `src/environments`, no `fileReplacements`; `production` config only sets budgets and output hashing | **Fail** |
| Production bundle contents (`dist/humo-web/browser`, just built) | `main-4PTUGR4N.js` contains "Prototype controls", "Sign in as", "Reset simulation", "Not part of the product", the `humo.sim.` storage key, and seeded persona names and emails (e.g. "Thandeka Mokoena", `terry@humo.example`). "Simulate: invitation accepted" is in a lazy chunk. | **Fail:** the persona switcher and mock data ship in the production build |
| Data sensitivity | Persona emails use `.example` domains; names, bank and account numbers are generated or fictitious; **no secrets found** in the PR diff (pattern scan for API keys, secrets, passwords, tokens) | Pass |

## 6. PR #3 review

| Aspect | Finding | Risk |
|---|---|---|
| Content | 477 `frontend/humo-web` files, 31 Markdown docs, 15 PNG brand assets, `package-lock.json` (6 121 lines). No `node_modules`, `dist`, `.env` or credentials. | Low |
| Title and description | Title "Identity & access, Humo platform layer, and Humo Contractor foundation"; the description covers only the early identity, platform, contractor and readiness work. **Checkpoints 5–10, Humo team management, the audit and D1–D10 aren't described.** | **Blocker:** reviewers can't know what they're approving |
| Stacking | Contains every commit of open PRs #1 and #2. Merging #3 makes them redundant: #1 will appear merged; #2 targets a non-`main` branch and stays open. | Blocker (housekeeping) |
| Configuration | Mock data and prototype controls in the production build (§5); no environment split | Blocker **for deployment**; not for merging a prototype, if `main` is understood as "prototype" |
| Access-control changes | Gateway authorisation, route guard, scheme resolver, Humo team and agency access commands are **untested** (0 tests, no CI). The simulated server doesn't enforce scope (F-02, F-08); the resolver contradicts D1. | High: none is real security, but the patterns will be copied into the backend |
| Known defects included | H-1 (restore → Active), H-3 (Humo address accepted by agency invites), H-2 (step-up before validation) | Medium |
| Size | 77 520 added lines in one PR | Review is impractical line by line; review by area and doc instead |

## 7. Comparison with the readiness matrix and remediation plan

| Claim (document) | Observed | Verdict |
|---|---|---|
| "107 lazy-loaded route components (136 routable screens…)"; "136 component routes" (earlier audit docs) | `app.routes.ts`: 107 `loadComponent` occurrences, of which 1 is inside the unused `planned()` helper → **106 routes with a component, 87 distinct page components, 22 redirects**. "136" was inflated by my extraction script's look-ahead. | **Unsupported:** correct to 106 / 87 / 22 |
| H-1 "Restore … makes them Active" (matrix §3, from code) | Reproduced live (S11) | Supported, now with live evidence |
| H-3 "Agency invites accept new @humo.example" (matrix §3, from code) | Reproduced live (S15) | Supported, now with live evidence |
| `docs/16`: "agency invites refuse Humo addresses" | Contradicted (S15) | **Doc is wrong** |
| Matrix: Humo team status **3** (works, with defects) | Consistent with S1–S17 | Supported |
| Matrix §4 "Build stability: Stable" | Type-check and build pass | Supported |
| Remediation P1-2 (mocks and prototype controls in production) | Confirmed in the built bundle (§5) | Supported. **Should arguably be P0 for deployment**; it stays P1 for a prototype `main`. |
| "No placeholder screens remain" | True on this branch: a 97-page-load sweep across 4 personas found no placeholder, blank or error pages and no console errors (render check only) | Supported for this branch |
| Matrix status 2 screens ("implemented, requires verification") | The sweep shows they **render**; their **actions** weren't exercised | Unchanged: still status 2 |

## 8. Merge blockers and non-blocking issues

**Blockers for merging PR #3 (all non-code):**

1. **PR title and description don't describe the change set.** Rewrite them to list Checkpoints 5–10, Humo team management, the audit and D1–D10, with a clear "frontend prototype, simulated data, not releasable" notice.
2. **Close PRs #1 and #2** as superseded by #3, so `main` has one integration path.
3. **Explicit acceptance that `main` will hold a prototype** whose production build ships mock data and the persona switcher (§5). If `main` must be deployable, P1-2 (environment-specific providers) becomes a blocker too.

**Non-blocking, to fix in Phase 2 (in order):**
- **P0-7:** H-1 (restore → previous status) and H-3 (refuse `@humo.example` in agency invites). Both confirmed live.
- **H-2:** validate before step-up.
- **No tests, lint or CI;** untested access-control code (P1-1).
- **Inert actions that look real** (P0-4).
- Scope not enforced in the simulated server; resolver contradicts D1 (P0-2, P0-3).
- **Bundle budget warning** (resolved by P1-2).
- **Documentation corrections:**
  - route counts (§7);
  - `docs/16` Humo-address claim;
  - `docs/09` stale blind-spot list.

## 9. Recommendation

**Hold PR #3, then merge it as one PR. Don't split it.**

**Hold** until blockers 1–3 are resolved. They're editorial and housekeeping: no code changes and no history rewrite.

**Then merge, without splitting:**
- The 22 commits build on each other, so splitting means rewriting history.
- `main` has no prior application to diff against, so splitting doesn't make review easier.
- The diff contains no secrets or unintended files.

The P0-7 defects and the missing test tooling don't change the merge decision for a prototype `main`. They should be the first Phase 2 work.

## 10. Smallest safe next implementation task (Phase 2, awaiting approval)

**Fix P0-7 in the mock data sources only:**

1. **Restore returns to the previous status.**
   - In `InMemoryHumoTeamDataSource`, `suspend` records the status before suspension (e.g. `invited` or `active`).
   - `restore` returns to it, so an invitee who never accepted goes back to **Invited**.
2. **Agency invites refuse the Humo domain.**
   - In `InMemoryAccessDataSource.invite` and `updateIdentity`, refuse any email ending `@humo.example` (`HUMO_EMAIL_DOMAIN`), not only existing Humo identities.

**Verify:**
- re-run S11 and S15 in the browser;
- type-check and production build;
- correct `docs/16`.

**Scope:** two files of application code plus one doc. No screens, design system or decisions change.

*Stopping here. Phase 2 starts only after your approval.*

---

## 11. Phase 2 result: P0-7 (approved and implemented on 10 October 2026)

**Changes** (application code; no screens, design system or decisions changed):

| File | Change |
|---|---|
| `domain/models/identity.ts` | `Identity.suspendedFrom?: 'invited' \| 'active'`: the status a restore returns to |
| `mock/data-sources/in-memory-humo-team-data-source.ts` | `suspend` records `suspendedFrom`; `restore` returns to it (default `active`) and clears it |
| `mock/data-sources/in-memory-access-data-sources.ts` | `invite` refuses any `@humo.example` address (`HUMO_EMAIL_DOMAIN`), not only existing Humo identities; `updateIdentity` refuses changing an agency user's email to a Humo address |

**Re-verification (live, dev server):**

| Check | Persona | Observed | Status |
|---|---|---|---|
| S11: restore a suspended invitee | Terry | New invitee `humo-59`: Invited → Suspended (`suspendedFrom: 'invited'`) → **Invited** (`suspendedFrom` cleared). The "Invited: they haven't signed in yet" banner and the accept button are back. | **Pass** |
| S11 regression: restore an active member | Terry | Kagiso: Active → Suspended → **Active** | **Pass** |
| S15: agency invite with a Humo address | Thandeka | `phase2.reserved@HUMO.example` (mixed case) → field error "That's a Humo staff address. Humo staff are managed by Humo, not from an agency."; nothing created | **Pass** |
| S15 regression: ordinary agency invite | Thandeka | `reserved.address@acacia-ma.example` → "Invitation sent…", listed | **Pass** |
| Edit an agency user's email to a Humo address | Thandeka (direct `updateIdentity` call) | Refused: "That's a Humo staff address. Use the person's own email." | **Pass** |
| Console errors | — | None | **Pass** |
| `tsc -p tsconfig.app.json --noEmit` | — | Exit 0 | **Pass** |
| `ng build` (production) | — | Exit 0; 1.36 MB initial (unchanged budget warning) | **Pass** |

**Known limitation:**
- An identity suspended *before* this fix has no `suspendedFrom`, so it restores to Active.
- Zinhle (`humo-38`) had already been restored to Active during Phase 1. Restoring her doesn't undo that.
- Both are simulated-data artefacts; the backend will store the previous status from the start.

**Still open from Phase 1:**
- H-2 (validate before step-up);
- the PR #3 title and description;
- closing PRs #1 and #2;
- the other P0 items in the remediation plan.

