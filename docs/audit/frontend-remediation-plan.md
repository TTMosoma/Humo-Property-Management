# Frontend remediation plan

**Date:** 10 October 2026.

**Basis:**
- [frontend-readiness-matrix.md](frontend-readiness-matrix.md)
- [current-state-summary.md](current-state-summary.md) (findings F-xx)
- [docs/17-decisions.md](../17-decisions.md) (D1–D10)

**Scope:** frontend work only, plus the contract and documentation changes the frontend needs. Backend work is in [backend-readiness-and-prioritised-roadmap.md](backend-readiness-and-prioritised-roadmap.md).

**Rules for this plan:**
- No approved decision is reversed.
- The design system isn't replaced.
- Working screens aren't touched except to fix the listed item.
- Not every placeholder or gap is P1: each item is classed by whether the first release needs it.

**Priorities:**
- **P0:** access control, data integrity, or misleading behaviour that could lead to an unsafe backend implementation.
- **P1:** core workflows needed for the first real client and the backend foundation (slice 1).
- **P2:** important supporting workflows and incomplete screens in the agreed release scope.
- **P3:** later enhancements, and deferred work.

**Effort:** S (≤ ½ day) · M (1–3 days) · L (> 3 days).

---

## P0: must fix before backend work builds on it

| # | Item | Why P0 | Evidence | Effort |
|---|---|---|---|---|
| P0-1 | **Merge PR #3 into `main`** (after review) and retitle it to match its content | `main` has no application; every review of `main` or an older branch shows "Planned screen" pages and no Humo team. The source of truth for the frontend must be unambiguous. | Matrix §0 | S |
| P0-2 | **Write the scope rule into the API contract** (`docs/08`): reads derive scope from the session and `schemeIds` is only a filter within it; commands check the target record's organisation and scheme; the mock gateway imitates it | Prevents endpoints that trust the client (F-02, F-08). Required by D1. | `mock-gateway.ts` `authorise()`; `SchemeDataSource.list()` | M |
| P0-3 | ✅ **Done 14 Oct 2026** (branch `feature/launch-foundation`). Resolver scopes by assignment; `Portfolio.BrowseAgency` is an individual read-only grant; the API refuses changes outside the assignment (`out-of-scope`). **Implement D1 in the frontend:** scheme resolver and scope by assignment; add the read-only "browse all schemes" permission; show a read-only state when browsing | The current behaviour contradicts an approved decision (F-07) | `scheme.resolver.ts` | S–M |
| P0-4 | ✅ **Done 10 Oct 2026** (branch `demo-ready`; still simulated, tracked in `docs/18` R-1, R-3, R-4). **Inert actions must not look real:** "Email statement", "Re-send statement", "Message through Humo", email quote invites. Either record them properly (Sent + issued document, per D9), or label them clearly as not available yet. | Misleading: users believe a statement was sent (F-15, F-16) | `statement-page.ts:133`, `account-page.ts:170`, `quote-compare-page.ts:186`, `quote-request-page.ts:88` | S |
| P0-5 | ✅ **Done 14 Oct 2026** (`StaffDirectory`: live assignments at runtime). **Live assignments, not seed data,** for portfolio-manager routing and names (`portfolioManagerOf`, `personName`) | Two sources of truth would be copied into the backend (F-03) | `mock/fixtures/staff.ts`, 10 callers | S–M |
| P0-6 | ✅ **Done 14 Oct 2026.** People links owners and tenants only; the trustee role needs a board seat; appointing grants access; seed reconciled (Sarah, Mpho). **Implement D2:** trustees only through the board (remove "Trustee of a scheme" from the People form); appointing grants trustee access when the person has a sign-in; reconcile seed data (Sarah, Mpho) | The legal board register must be the only source of truth (F-06, F-28) | `board-store.ts`, `person-forms`, `personas.ts` | M |
| P0-7 | ✅ **Done 10 Oct 2026** (Phase 2; see `phase-1-verification-report.md` §11). **Humo staff separation:** refuse `@humo.example` addresses in agency invites (H-3). Restore a suspended Humo invitee to *Invited*, not *Active* (H-1). | Account status integrity, and the internal versus customer boundary | `in-memory-access-data-sources.ts:75`, `in-memory-humo-team-data-source.ts:310` | S |
| P0-8 | ✅ **Done 10 Oct 2026** (branch `fix/checkpoint-7-gaps`). **Compliance for onboarding schemes:** no overdue items or Tasks before the scheme's "managed since" date; no unassigned Tasks | False alarms on every new scheme (F-12) | W4; `compliance-store.ts` | S–M |
| P0-9 | ✅ **Done 10 Oct 2026** (branch `demo-ready`; `docs/18` R-2). **Statements are previews until D7:** label past statements "Preview: re-rendered from current data". Document that the backend stores issued PDFs. | The current behaviour contradicts D7 (F-44) and can show new bank details on old statements | `mock-db.ts:278–295` | S |

## P1: core workflows for the first client and slice 1

| # | Item | Notes | Evidence | Effort |
|---|---|---|---|---|
| P1-1 | 🟡 **CI added 14 Oct 2026** (`.github/workflows/ci.yml`: type-check, tests, production, demo and contractor builds, and a guard that production contains no demo data). Still to do: ESLint, a Prettier check (after the P3-9 formatting pass), and running the specs against the HTTP adapters as ports are swapped. **Test harness:** test target (Vitest, as `tsconfig.spec.json` expects); lint; Prettier check; **contract tests per port**, run against the in-memory adapter now and the HTTP adapter later | No tests today; `npm test` fails (F-01) | Audit evidence C1, C2 | M |
| P1-2 | ✅ **Done 14 Oct 2026.** Production builds use `provideHttpData()` (GET /me; other ports "not connected"); no mocks or prototype controls in production; the demo build keeps the simulation. **Environment-specific providers:** mock data and prototype controls only in development; an empty HTTP data layer behind the same ports for production builds | Mocks and the persona switcher ship in production (F-05) | `app.config.ts` | S–M |
| P1-3 | **Implement D3:** *Invite* on the person, unit and board pages, prefilled; Portfolio Managers may invite residents and trustees in scope (new permission); first-administrator invite restricted to Agency Administrator (F-22) | | Person page "Not invited yet" (F-27) | M |
| P1-4 | ✅ **Reviewed 14 Oct 2026.** The one security-relevant check (scheme resolver) is fixed under D1. The remaining role-name checks choose dashboard cards, home screens, tab bars and wording, or are meeting-attendee roles; the server decides access. **Implement D4 hygiene:** replace security-relevant `role ===` checks with permissions | 29 checks, most harmless (meeting attendee roles) | Read-only search | S |
| P1-5 | ✅ **Done 14 Oct 2026** (`saDate()` / `todaySA()`, Africa/Johannesburg; 24 uses replaced). **Date handling:** one "today in Africa/Johannesburg" helper; plain calendar dates | Off-by-one dates near midnight (F-26), 17 uses | W3 | S |
| P1-6 | ✅ **Done 10 Oct 2026** (branch `fix/h2-validate-before-step-up`). **Validate before step-up** in Humo team and agency invites (H-2) | Avoids passkey prompts for doomed requests | Live trace | S–M |
| P1-7 | **Platform onboarding polish:** correct the instruction text (F-21); customer name in the breadcrumb (F-24); "Too new to score" instead of Critical health (F-23) | First-client onboarding is the first thing Humo staff do | W1 | S |
| P1-8 | ✅ **Done 18 Oct 2026** for slice 1: [24-slice-1-acceptance-criteria.md](../24-slice-1-acceptance-criteria.md). **Extract business rules from the mock stores** into acceptance criteria, for slice-1 modules (organisation, scheme, unit, person, relationship, access, Humo team, audit) | The mocks are the spec (F-11) | Roadmap R3 | M |

## P2: supporting workflows in the release scope

| # | Item | Evidence | Effort |
|---|---|---|---|
| P2-1 | **Levy model, once decided:** quota versus levy validation or derivation (F-14); derive occupancy from relationships (F-25) | W2 | S–M |
| P2-2 | **Statement delivery per D9:** agency setting (link or attachment); record in Sent; invitation with the first statement | D9 | M |
| P2-3 | **Receipt capture and bank-statement import** screens | No capture today | L |
| P2-4 | **Job "edit details"** (audited); full lifecycle re-verification | `docs/09`, W5 | M |
| P2-5 | **D6 conflict rule** in approvals (a staff member who's a trustee can't approve their own agency's work) | D6 | M |
| P2-6 | **Verify the "Implemented, requires verification" screens** in the matrix (billing run, receipts allocation, credit control, payables, meetings, reports, settings, flags) and record the results | Matrix status 2 | M |
| P2-7 | **Unassigned work routing:** staff-logged jobs and compliance Tasks without a portfolio manager go to an agency queue (F-29) | W5 | S |
| P2-8 | **Security page during impersonation:** explain why the buttons are disabled | Matrix | S |
| P2-9 | **Documentation corrections:** `docs/09` §4 (F-34); `docs/16` agency-invite claim; qualify "No placeholder screens remain" with the branch; README "Backend readiness" wording | Matrix §5 | S |

## P3: later and deferred

| # | Item | Status |
|---|---|---|
| P3-1 | ✅ Done 10 Oct 2026 (branch `demo-ready`). Remove dead code: `features/planned/*`, `planned()` helper (F-33); also about 80 unused imports, with `noUnusedLocals` and `noUnusedParameters` now on | Cleanup |
| P3-2 | Naming review of the 133 bare "Humo" candidates against doc 07 (F-31) | Cleanup |
| P3-3 | Plan message wording under Observe (F-30) | Cosmetic |
| P3-4 | Person merge; unit archive and renumber; bulk resident invites | Deferred (D3, `docs/09`) |
| P3-5 | Configurable role profiles | Deferred (D4) |
| P3-6 | Catalogue editor; real executive analytics; real telemetry on Platform health | Deferred |
| P3-7 | Humo Contractor portal and network messaging | Separate product |
| P3-8 | Executive statement template; invoice, receipt, work-order and owner-statement documents | Planned in the template catalogue |
| P3-9 | Prettier formatting pass (385 files) in one dedicated commit | Tooling, after P1-1 |

## Suggested order

1. **P0-1** (merge and retitle PR #3), so that everyone reviews the same code.
2. **P0-7, P0-4, P0-9:** small, isolated fixes that remove misleading or incorrect behaviour.
3. **P1-1, P1-2:** the safety net and environment split, before the larger P0 items change shared code.
4. **P0-2, P0-3, P0-5, P0-6, P0-8:** the access and data-integrity corrections, each with contract tests.
5. **P1-3 … P1-8,** then slice-1 backend work.
6. **P2** items as their slices come up; **P3** when convenient.
