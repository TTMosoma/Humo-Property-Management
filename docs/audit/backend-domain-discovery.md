# Backend domain discovery (preliminary)

**Purpose:** a validated starting point, derived from what the frontend already implies. It is **not** a schema or an API design.

**Sources:**
- **Ports** (`domain/ports`, 40 data sources): these are the de facto API surface.
- **Models** (`domain/models`).
- **Mock "server" rules** (`mock/db`, `mock/data-sources`, `mock/server`).
- **Existing docs** `03`, `04`, `08`, `10`–`16`.

> **The mock stores are the most complete business-rule specification in the repository.** They will be replaced, not ported, so their rules must be extracted into backend acceptance criteria before they're discarded (F-11).

**Key:** **Inv** invariant · **Perm** permission · **Q** open question.

---

## A. Identity and access (Humo platform: shared by every Humo product)

| Aggregate | Purpose and relationships | Lifecycle | Key rules and invariants | Perm and audit | Frontend dependencies |
|---|---|---|---|---|---|
| **Identity** | One per human (by email); `kind` customer or Humo; → memberships → role assignments | invited → active → suspended → deactivated | Inv: unique email; Humo addresses only for Humo staff; credentials belong to the identity provider | `Users.Manage`, `Users.ManageAdmins`, `Platform.ManageHumoRoles`; always audited (security) | Users & access, Humo team, platform users, prototype sign-in |
| **Membership** | Identity ↔ Organisation | active ↔ suspended → ended | Suspending pauses every assignment in that organisation; ended is kept | Same | Users & access |
| **Role assignment** | Role + scope (platform, organisation, schemes, unit, party), label, grants (e.g. `System.Impersonate`), optional validity | active → ended | Inv: no self-escalation or self-change; duplicates refused; admin roles need step-up; System Administrator needs a second System Administrator; the last System Administrator is protected | Step-up actions `change-roles`, `add-administrator`, `change-humo-team` | Role switcher, `GET /me` (`docs/08` §2) |
| **Session / step-up proof** | Active assignment, impersonation context, proof freshness (5 min) | — | The proof is bound to the session; 12 sensitive actions | — | Every sensitive form |
| **Impersonation session** | Actor (Humo) → target identity and assignment; mode Observe or Act; reason, ticket | started → ended | Observe refuses every write; Act needs step-up and a case reference; Humo staff can't be impersonated; visible to the customer | Audit category `impersonation` | Platform users, banner |
| **Audit event** | Append-only record of every command (success or denied) | — | Inv: immutable; names actor and acting-as; retention (7 years in settings) | `Audit.View`, `Platform.Audit` | Audit pages |

**Q:**
- Identity provider and passkey or step-up implementation (D5).
- Configurable profiles (D4).
- Whether staff may hold resident or trustee roles at schemes they manage (D6).

## B. Platform and commercial (Humo business layer)

| Aggregate | Purpose | Lifecycle | Rules | Perm |
|---|---|---|---|---|
| **Organisation** (customer agency) | Tenant boundary; → schemes, memberships, subscription | onboarding → active → suspended → archived | Suspended blocks sign-in for its members (`signed-out` reasons) | `Platform.Customers.Manage`, `Organisation.Manage` |
| **Subscription** | Package + add-ons + overrides (feature, enabled, reason, expiry) + account manager | trial → active → past-due → suspended → cancelled | Changes need a reason and step-up (`change-subscription`); effective entitlements = package ∪ add-ons ± overrides | `Platform.Subscriptions.Manage` |
| **Catalogue** (features, packages, add-ons) | Names and packaging as data; feature *keys* in code (`docs/08` §7) | Versioned? | **Q:** editing UI doesn't exist (`docs/09`) | `Platform.Packages.Manage` |
| **Feature flag** | Technical rollout per environment | — | Flag **and** entitlement must both allow | `Platform.Config.Manage` (step-up in production) |
| **Incident / system configuration** | Health, maintenance banner, upload limit, session and retention policy | open → … → resolved | — | `Platform.Operations.Manage` |

**Q:**
- How customer health is scored for onboarding customers (F-23).
- Whether MRR, targets and executive figures come from billing (Humo's own) or are reporting-only.

## C. Portfolio (Humo Property Management)

| Aggregate | Purpose and relationships | Lifecycle | Key rules | Frontend dependencies |
|---|---|---|---|---|
| **Scheme** | Body corporate or HOA; organisation-owned; code (prefix of account numbers), type (Sectional Title, HOA, Share Block); → units, trust account, compliance profile (financial year-end, lifts) | prospect → onboarding → active → closed → archived (closed → active reopen; archived → closed restore) | Inv: code unique per organisation (**to verify**); portfolio manager = earliest active Portfolio Manager assignment covering it (**derive from live assignments**, F-03) | Everywhere |
| **Unit** | Section or erf; number, block, size, quota, monthly levy, parking; → levy account (1:1) | (no archive today) | **Q:** levy derived from quota × budget, or entered (F-14); archive or renumber rules (`docs/09`) | Units, unit, account |
| **Person** | Directory record (individual, company, trust), contact, preferred channel | (no delete or merge) | One record per human; **Q:** duplicate merge | People |
| **Relationship** | Person ↔ unit (owner, tenant) or ↔ scheme (trustee); since or until; trustee appointment (elected with resolution, co-opted, before-Humo) and end reason | active → ended | A new owner becomes the account holder; **Q:** one source of truth for trustees (D2) | Person, unit, board |
| **Trust account** | Scheme bank account for payments | unverified → verified (bank letter) | Change needs step-up (`change-bank-details`); shown on statements and letters | Settings › Agency, documents |

## D. Finance

| Aggregate | Purpose | Lifecycle and commands | Key rules and invariants | Perm |
|---|---|---|---|---|
| **Levy account + ledger** | Per unit; **transactions are the source of truth**; balance, ageing and status derived (F-04) | Commands: post charges (billing), allocate receipt, journal adjustment, interest | Inv: money in cents or `DECIMAL(18,2)`, server-computed totals (`docs/08` §7); status (arrangement, handed-over) sticky while in arrears | `Accounts.View`, `Billing.Run` |
| **Billing run** | Period charges for a scheme (levy, special levy, water, interest) | draft → calculated → exceptions decided → awaiting approval → approved → **posted (locks)** → statements sent | One run per scheme per period; exceptions must be decided; approval as a work item; posting is irreversible except by journal; statement sending respects the kill switch | `Billing.Run`, `Approvals.Decide` |
| **Issued statement** | Statement per account per period | issued | **Must be immutable once issued** (F-44, D7) | `Account.ViewOwn` for residents |
| **Receipt** | A bank credit | unallocated → allocated (one or more accounts) or suspense; unallocate | Allocation total = receipt amount; payer rules; **capture or import missing** | `Receipts.Allocate` |
| **Collection case** | Per account in arrears | not-started → reminder → final demand → (trustee approval) letter of demand → handed over; side states arrangement and dispute | Letter of demand needs a trustee approval; letters record a template version; reminders in bulk | `Collections.Manage` |
| **Budget** | Annual per scheme, lines by category | draft → proposed (AGM agenda item) → approved (passed resolution) | Figures fixed once proposed; actuals from invoices plus brought-forward | `Budgets.Manage` |
| **Payables** (invoice, payment batch) | Supplier invoices against jobs and contracts | awaiting approval → approved → in batch → paid (or rejected) | Delegation limits; batch release with step-up (`release-payment`) | `Payables.Prepare`, `Payables.Release` |

**Q:**
- Interest rules.
- Levy versus quota (F-14).
- Debit orders.
- Bank import formats and banks.
- VAT on charges and invoices.
- Accounting integration (general ledger, trust accounting requirements under the Property Practitioners Act and the STSMA). This needs a domain expert.

## E. Maintenance and suppliers

| Aggregate | Lifecycle | Rules | Perm |
|---|---|---|---|
| **Job** | reported → triaged → quotes → approval → work order → booked → in progress → done → verified → invoiced → paid → closed; cancel | 14 actions (see the CRUD matrix); approval within delegation or by trustees; staff-logged jobs are assigned to the portfolio manager (F-29) | `Maintenance.Log`, `Maintenance.Manage` |
| **Quote / work order** | requested → received → awarded | Network quotes through Humo Contractor (separate product) | `Maintenance.Manage` |
| **Supplier** | active ↔ suspended | Vetting documents (COIDA, public liability) with expiry; bank change needs step-up | `Suppliers.Manage` |

**Q:** whether job details can be edited after logging (`docs/09`).

## F. Governance

| Aggregate | Lifecycle | Rules |
|---|---|---|
| **Meeting** (trustee, AGM, SGM) | draft (agenda) → notice sent → pack ready → held → minutes draft → minutes approved; cancel | Notice periods (7 days trustee, 14 days AGM/SGM); quorum from attendance; agenda fixed after notice; documents record their template version |
| **Resolution / action** | proposed → passed or failed; actions → work items | Votes ≤ voters present; written resolutions via Approvals |
| **Trustee board** | (relationships) appoint → end term | Minimum size (compliance item); elected needs a passed resolution; co-opted until the next AGM; one chairperson |
| **Scheme rule / breach** | rule: in force → amended (versions) → repealed. Breach: reported → warned → final warning → with trustees → resolved | Rule changes cite a resolution; **no fines** (product decision) |

## G. Communications, documents, compliance, work

| Aggregate | Notes |
|---|---|
| **Notice, message template, message + deliveries, conversation** | Channel per person (preference among chosen channels; WhatsApp kill switch); deliveries have a status and retry; scheduled sends; inbound replies (**Q:** inbound email, SMS and WhatsApp provider) |
| **Library document** | Linked to records; visibility (staff, trustees, owners, unit); expiry; supersedes the previous one of the same compliance or vetting kind; **object storage required** |
| **Document template / version / branding** | Tiers gated by entitlement; versions immutable once published; custom templates per organisation |
| **Compliance item** | **Derived** from meetings, documents, suppliers and financial years, plus records and manual items; generates Tasks (**fix for onboarding schemes**, F-12). **Q:** compute on read, or materialise? |
| **Work item** (Task, Approval) | Created by other aggregates (source ref and route); assignee routing honours away cover; decide (approve or reject) is the approval command |
| **Staff cover** | Moves open non-approval work; routes new work while away |

## H. Likely API operations

`docs/08` already defines the conventions:
- `GET /me` bootstrap;
- `ListQuery`/`Page<T>`;
- versions → 409;
- 422 field errors;
- money and time formats.

Ports map one-to-one to endpoints. Each port's mutating methods are **business commands** (`act(id, action)`, `allocate`, `releaseBatch`, `changeSubscription`, …). Implement them as command endpoints (`POST /{resource}/{id}/actions` or named sub-resources), not PATCH-CRUD.

Reads that need scope-aware server filtering and paging:
- these 10 already return `Page<T>`;
- **18 list ports return plain arrays** and must gain paging before real volumes (F-20). Candidates: budgets, sent, breaches, library, compliance, staff, invoices, batches, templates, boards.

## I. Areas too unclear to design safely (need product or domain input)

1. Trust-accounting and the general ledger: what Humo Property Management is the system of record for versus the agency's accounting package.
2. Levy calculation model (quota, budget, special levies), interest and VAT.
3. Trustee authority model (D2) and approval thresholds (delegation limits per scheme?).
4. Resident identity: how owners and tenants are verified and invited (D3), and POPIA consent for channels (WhatsApp, SMS).
5. Statement immutability and numbering (D7, D10).
6. Multi-agency people: can one person be an owner at schemes managed by two agencies (two organisations)? The identity model allows several memberships; the portfolio directory is per organisation.
7. Data migration from the previous system (budgets' brought-forward is simulated): format, reconciliation and opening balances.
