# Current-state summary

Audit of the Humo Property Management frontend before backend work · 9–10 October 2026 · commit `edb67df` · audit only, no code changed.

**Decisions D1–D10 were approved on 10 October 2026:** [docs/17-decisions.md](../17-decisions.md).

**Companion documents:**
- [screen-completeness-matrix.md](screen-completeness-matrix.md)
- [crud-and-data-integrity-matrix.md](crud-and-data-integrity-matrix.md)
- [roles-permissions-and-entitlements-audit.md](roles-permissions-and-entitlements-audit.md)
- [workflow-test-results.md](workflow-test-results.md)
- [document-and-pdf-audit.md](document-and-pdf-audit.md)
- [backend-domain-discovery.md](backend-domain-discovery.md)
- [backend-readiness-and-prioritised-roadmap.md](backend-readiness-and-prioritised-roadmap.md)
- [audit-evidence-and-test-log.md](audit-evidence-and-test-log.md)

**Status definitions** (used throughout):

| Status | Meaning |
|---|---|
| **Complete and verified** | Implemented and supported by an actual successful check |
| **Implemented, not verified** | Present, but not exercised in this audit |
| **Partially implemented** | Some required behaviour exists, with identifiable gaps |
| **Mock/simulated** | Depends on frontend mock data or simulation |
| **Planned/not implemented** | No functional implementation found |
| **Blocked/unknown** | Can't be established from the available evidence |

**Because there is no backend, every feature is also Mock/simulated.** "Verified" in these documents always means *verified in the simulation*.

## 1. Overall assessment

**A broad, coherent, clickable product prototype with a good seam for a backend, and with its security model and core money model still to be designed for real.**

- **Breadth (observed):**
  - 136 routed screens across portfolio, finance, maintenance, communications, documents, governance, compliance, reports, settings, the resident portal, the Humo platform, and a prototyped Humo Contractor portal.
  - **No placeholder screens remain.**
- **Architecture (observed):**
  - Components → 40 abstract data-source **ports** → in-memory adapters → 22 mock stores.
  - Every write goes through one mock gateway (permission, entitlement, Observe-mode, step-up, version, validation, audit).
  - No feature code imports mock code, so the HTTP swap is mechanical, port by port.
- **Quality signals (observed):**
  - Strict TypeScript and strict templates pass (C3); the production build passes (C5).
  - **No automated tests** (0 spec files; `npm test` fails: C1, C2).
  - No lint; 385 files deviate from the repo's own Prettier configuration (C4).
- **Security (observed):**
  - All access control is UX-only, as the code itself states.
  - The simulated server **doesn't enforce scope** on reads or commands (F-02, F-08).
  - Authentication is a persona picker.
  - Mocks and the prototype controls ship in production builds (F-05).
- **Data (observed):**
  - Several duplicated sources of truth: trustee board versus trustee access (F-06); seed versus live identities for routing (F-03).
  - Balances aren't derived from transactions (F-04).
  - Issued statements re-render from current data (F-44).

## 2. What is genuinely implemented (with evidence)

**Verified in this audit or earlier in this session (simulation):**
- Agency onboarding and first-administrator invite (W1).
- Scheme, unit, owner and relationship creation and propagation (W2–W4).
- Maintenance request logging (W5, to triage).
- Account and statement consistency (W6).
- Role and plan gating, and impersonation in Observe mode (W7, W8).
- Checkpoint 10 modules: budgets, trustee boards, rules and breaches, Sent, inbox, staff cover (docs/15).
- Humo team management (docs/16).

**Implemented, not verified in this audit:** billing runs, receipt allocation, credit control, payables, meetings and resolutions, reports, settings, feature flags, platform health, document templates. Their checkpoint docs report browser testing when they were built.

**Planned/not implemented:**
- receipt capture and bank import;
- PDF generation (browser print only);
- 7 of 11 document types;
- real message delivery;
- file storage;
- authentication and identity provider;
- configurable role profiles;
- job edit;
- person merge;
- unit archive.

## 3. Major strengths

1. **A clean port and adapter seam** with a single command gateway, and API conventions already written (`docs/08`).
2. **Consistent UI patterns:** one form drawer, data table, record header, empty, error and loading states, and one step-up and reason idiom for sensitive actions (F-32).
3. **A rich, explicit domain model:** lifecycles as commands rather than CRUD, version tokens, audit, entitlements, impersonation with Observe/Act, two-person rules.
4. **A documented document-rendering standard** (A4, page breaks, one renderer) with template versioning.
5. **Good documentation discipline:** per-checkpoint docs, brand architecture, simulation notes.

## 4. Findings register

**Severity:**
- **Critical:** must be resolved before real data or release.
- **High:** blocks or distorts the backend design.
- **Medium:** fix during the relevant slice.
- **Low:** cosmetic or later.

**Basis:** Fact = observed in code or execution · Test = observed in a browser workflow · Inference = reasoned from code.

| ID | Finding | Basis | Severity |
|---|---|---|---|
| F-01 | No automated tests; `npm test` fails (no test target); no lint | Fact (C1, C2, C6) | High |
| F-02 | Commands aren't scope-checked by the mock gateway | Fact (code); the write itself is an inference | **Critical** (backend) |
| F-03 | Portfolio-manager routing and names use seed identities, not live assignments | Fact (code) | High |
| F-04 | Balances are stored and adjusted; history is generated; the ledger isn't the source of truth | Fact (code) | High (design) |
| F-05 | Mock data layer and prototype controls are always provided, production included; no environment configuration | Fact (`app.config.ts`) | **Critical** before release |
| F-06 | Trustee board (relationships) and trustee access (role assignments) are separate and partly synced | Fact (code, seed) | High (decision D2) |
| F-07 | Any Portfolio Manager can open every scheme in the agency (role-name check in the resolver) | Test W7 + code | High (decision D1) |
| F-08 | Read ports trust client-supplied `schemeIds`; the scheme list returns all agencies | Fact (code) | **Critical** (backend) |
| F-09 | 22 stores persisted independently; partial resets are inconsistent | Fact | Low |
| F-10 | Denormalised names (account manager, reporter, decider) go stale | Fact | Medium |
| F-11 | Business rules exist only in mock stores that will be replaced | Fact | High |
| F-12 | Onboarding schemes get overdue compliance items and unassigned Tasks immediately | Test W4 | High |
| F-13 | Seeds are relative to the day each store was first seeded | Fact | Low |
| F-14 | Participation quota and monthly levy are independent inputs | Test W2 | Medium (decision) |
| F-15 | Statement "Email" and "Re-send" are toasts; nothing recorded | Fact (code) | Medium |
| F-16 | Network messaging and quote email invites are "planned" toasts | Fact | Low |
| F-17 | Initial bundle 1.36 MB, over the 1.2 MB budget | Fact (C5) | Low (resolved by R5) |
| F-18 | 385 files not formatted to `.prettierrc`; no format or lint scripts | Fact (C4) | Low |
| F-20 | 18 list ports return unpaged arrays | Fact | Medium |
| F-21 | Onboarding form points to the wrong page for the administrator invite | Test W1 | Low |
| F-22 | First-administrator invite allows any customer role | Test W1 | Medium |
| F-23 | New customers show "Critical" health | Test W1 (known, `docs/09`) | Low |
| F-24 | Raw id in the platform customer breadcrumb | Test W1 | Low |
| F-25 | "Owner-occupied" shown for a unit with no owner | Test W2 | Low |
| F-26 | UTC date defaults (17 uses) produce off-by-one dates near midnight | Test W3 + code | Medium |
| F-27 | No "invite to portal or Humo PM" from person, unit or board | Test W3 | Medium |
| F-28 | Trustee relationships can be created from People, bypassing board rules | Test W3 | Medium |
| F-29 | Staff-logged jobs on schemes without a portfolio manager are unassigned | Test W5 | Low |
| F-30 | Plan message wording is wrong during Observe impersonation | Test W8 | Low |
| F-31 | 133 bare "Humo" candidates still need a doc-07 review | Fact (scan) | Low |
| F-32 | *(Strength)* Consistent UI patterns: one form drawer, data table, record header, and one step-up and reason idiom | Fact | — |
| F-33 | `planned()` helper and `features/planned` are dead code | Fact | Low |
| F-34 | `docs/09` blind-spot list is stale | Fact | Low |
| F-35 | Responsive and accessibility behaviour not tested in this audit | Limitation | Blocked/unknown |
| F-36 | Uploaded files aren't persisted (session object URLs) | Fact | Medium (simulation) |
| F-37 | Cross-store command effects have no transactional boundary | Fact | Medium (design) |
| F-38 | 29 role-name checks in UI logic (some security-relevant) | Fact | Medium |
| F-39 | Some child routes rely on the parent route's permission | Fact | Low |
| F-40 | Resident onboarding and invite model undecided | Fact | Medium (decision D3) |
| F-41 | The audit log is browser-stored (editable) | Fact | High (backend) |
| F-42 | Step-up is simulated (no WebAuthn or push) | Fact | High (backend) |
| F-43 | No server-rendered PDF for emailed statements | Fact | High (go-live) |
| F-44 | Issued statements re-render from the current ledger, holder and trust account | Fact (code) | High (design D7) |
| F-46 | Approved fonts must exist in the future render environment | Docs | Medium |
| F-47 | Shared rule book is ad-hoc HTML, not a template document | Fact | Low |

## 5. Facts versus assumptions

- **Facts** are tied to files, commands (C1–C7) or browser workflows (W1–W8) in the evidence log.
- **Inferences**, marked as such:
  - writes outside scope would succeed (F-02 / W7);
  - the mock stores encode the intended rules (F-11);
  - earlier checkpoints' features still work as their docs describe. The build passes, but behaviour wasn't re-tested.
- **Not established:** accessibility and responsive quality (F-35), print and PDF fidelity today, and behaviour with two concurrent users.
