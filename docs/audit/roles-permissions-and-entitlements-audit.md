# Roles, permissions, scope and entitlements audit

**Intended model** (`docs/03-identity-access.md`, `docs/04-platform-commercial.md`):

**Identity → Role (profile) → Permissions → Scope → Feature entitlements → Context → Audit**

**The governing statement in the code** (`core/access/access.guard.ts`): *"This is UX gating only. The .NET API enforces permissions, scope and entitlements on every request — hiding a page protects nothing by itself."* This audit confirms that **nothing in the frontend is a security control**. Everything below describes UX behaviour and what the mock server imitates.

## 1. What is implemented (observed)

| Layer | Implementation | Evidence | Status |
|---|---|---|---|
| **Identity** | `Identity` (one per human, by email), `kind: customer \| humo`, status invited → active → suspended → deactivated. **No authentication:** you "sign in" by choosing a persona in the prototype controls (`MockAuthSession.signIn(identityId)`); session state is in localStorage. | `domain/models/identity.ts`, `mock/server/mock-auth-session.ts` | Mock/simulated |
| **Memberships** | Identity ↔ Organisation with a status; suspending pauses every assignment in that agency. | `identity.ts` `activeAssignments()` | Implemented (mock) |
| **Roles** | 8 customer roles (Agency Administrator, Portfolio Manager, Finance User, Operations/Maintenance, Trustee, Owner, Tenant, Contractor/Supplier) and 4 Humo roles (System Administrator, Account Manager, Support, Executive). Fixed role → permission map (`ROLE_PERMISSIONS`). | `domain/models/role.ts`, `permission.ts` | Implemented; **no configurable profiles** (`docs/08` §8) |
| **Permissions** | **67** permission keys, each with an area, a `mutates` flag and a `stepUp` flag. Screens use `session.can()` (91 uses in features); routes use `data.permission`. | `permission.ts` | Implemented (UX) |
| **Scope** | Assignment scope: `platform \| organisation \| schemes \| unit \| party`. A scope chip narrows the client view (`ScopeService.effectiveIds`). | `identity.ts`, `scope.service.ts` | **Client-side only** (see §2) |
| **Multiple roles and role switching** | One identity holds several assignments (e.g. Sarah: Portfolio Manager, Finance, Agency Administrator, Trustee) and switches from the top bar; the mock "issues a token" for the chosen assignment. | `AccessDataSource.switchRole`, W8 | Verified (sim) |
| **Entitlements** | 42 feature keys; packages Essentials, Professional and Enterprise; add-ons (e.g. Governance, Compliance); trial overrides with expiry. Routes use `data.feature`; screens use `session.hasFeature()`; the mock gateway refuses commands for features the agency doesn't have. | `entitlement.ts`, `mock-gateway.ts` | Verified (sim) W8 |
| **Feature flags** | Technical flags per environment (rollout %, allow and deny lists, kill switches); a flag *and* an entitlement must both allow a feature. | `domain/models/ops.ts`, `docs/14` | Implemented, not verified (this audit) |
| **Step-up** | 12 sensitive actions (e.g. release payment, change bank details, change roles, impersonate in Act mode, change Humo team); the proof is "fresh" for 5 minutes; simulated passkey or Humo Mobile. | `security.ts`, `step-up.service.ts` | Verified (sim) |
| **Impersonation** | Humo System Administrators with an **individual** `System.Impersonate` grant; Observe (read-only) or Act (case reference, note, step-up); banner; audit names the actor and the impersonated user; customers see the sessions in their audit log; Humo staff can't be impersonated. | `in-memory-access-data-sources.ts` `startImpersonation`, W8 | Verified (sim) W8 |
| **Audit** | Every gateway command (success and denied) is recorded with actor, acting-as, role, organisation, scheme, step-up method, session. Stored in the browser. | `mock-gateway.ts` `audit()` | Mock/simulated |
| **Humo internal versus customer separation** | Humo roles have platform scope; Humo addresses can't be invited into agencies; agency screens never list Humo staff; the Humo team is managed only by System Administrators, with two-person approval for System Administrator. | `docs/16`, `in-memory-humo-team-data-source.ts` | Verified (sim) |

## 2. Gaps between the implementation and the intended model

| ID | Gap | Evidence | Why it matters | Severity |
|---|---|---|---|---|
| F-02 | **Commands aren't scope-checked.** `MockGateway.authorise` checks Observe mode, permission, entitlement and step-up, but never compares `spec.schemeId` (or the record's scheme) with the assignment's scope. Its own comment lists scope as a backend duty. | `mock-gateway.ts` `authorise()` | A user with a permission in one scheme can, in the simulation, change records in another. The backend **must** enforce scope per record. | **Critical** (for the backend) |
| F-08 | **Reads trust caller-supplied scope.** Read ports take `schemeIds` from the client (e.g. `BudgetDataSource.list(schemeIds)`), and `SchemeDataSource.list()` returns **every scheme of every agency**; screens filter. | `in-memory-scheme-data-source.ts:50`, `records` ports | The API must derive scope from the token. `schemeIds` must be a *filter within* scope, never a grant. | **Critical** (for the backend) |
| F-07 | **Portfolio Managers can open any scheme in their agency.** The resolver hard-codes `membership.role === 'portfolio-manager'` as unrestricted, which contradicts the guard's "roles never appear here". The `Portfolio.Browse` permission ("every scheme … in scope") is ambiguous. | `scheme.resolver.ts`, W7 | A product decision is needed: may a Portfolio Manager *read* schemes outside their assignment, and if so read-only? | High (decision) |
| F-06 | **Trustee board ≠ trustee access** (two records, partly synchronised). | See the data-integrity matrix | Who may approve or vote must have one source of truth | High (decision) |
| F-05 | **Prototype controls and mock data ship in the production build.** `app.config.ts` always calls `provideMockData()`, which provides `PrototypeControls` (persona switcher, reset). There are no environment files. | `app.config.ts`, evidence log | Must be replaced by an HTTP data layer and environment-specific providers before any real deployment | **Critical** before release |
| F-38 | **Role names in UI logic** (29 `role ===` checks; most are meeting attendee roles, some are security-relevant: the scheme resolver, dashboard branches, invite forms). | Read-only search | When roles become configurable profiles, these checks must become permission checks | Medium |
| F-39 | **The page guard checks only the route's own `data.permission`**, not inherited parents. Some child routes have no permission (e.g. `/finance/billing/:runId`, `/governance/meetings/:id`); they rely on the parent route's guard. | `access.guard.ts`, route table | Fine for UX if the parent is guarded; the API must check every endpoint | Low |
| F-22 | The first-administrator invite (platform) allows any customer role. | W1 | Could create an agency whose "first administrator" is a tenant | Medium |
| F-40 | **Self-service and resident onboarding are unresolved:** owners and tenants get access only through an Agency Administrator's invite in Settings; no invite from the person record or board; Portfolio Managers can't invite. | The previous answer to the user; W3 (F-27) | Unclear operational model | Medium (decision) |
| F-41 | **Audit integrity:** in the simulation the audit log lives in localStorage, which the user can edit. | `access-store.ts` | The backend needs append-only storage, retention (7 years is configured in settings), tamper evidence and export controls | High (backend) |
| F-42 | **Step-up is simulated.** No WebAuthn ceremony, no Humo Mobile push, no server-issued proof. | `mock-auth-session.ts` | Design with the identity provider choice | High (backend) |

## 3. What the backend must enforce (minimum)

1. **Authentication** through an identity provider: passkeys first, then an organisation-aware session or token carrying identity, the active assignment, and the impersonation context.
2. **Authorisation on every endpoint:**
   - the permission of the **active** assignment;
   - **scope by record** (organisation and scheme membership of the target record, unit for residents, party for contractors);
   - the **entitlement** of the organisation (package, add-ons, overrides) **and** the feature flag.
3. **Observe-mode refusal** of every write; Act mode needs a fresh step-up and a case reference.
4. **Step-up proof freshness** for the 12 sensitive actions; the proof is bound to the session.
5. **Self-protection rules:**
   - nobody changes their own access;
   - the last System Administrator is protected;
   - two-person approval for System Administrator;
   - admin-only grants of Agency Administrator.
6. **Concurrency** (version or ETag → 409) and **validation** (422 field errors), matching `docs/08` §4.
7. **An append-only audit** of every command, success or denied, naming the actor and the impersonated user.
8. **Resident data minimisation:** an owner sees only their own units and accounts; document visibility (staff, trustees, owners, unit).

## 4. Decisions required

| # | Decision | Options seen in code or docs |
|---|---|---|
| D1 | Can a Portfolio Manager read (or change) schemes outside their assignment? | Today: read everything in the agency (resolver) and, by inference, write too |
| D2 | One source of truth for trustees: is the board relationship the authority, with access derived from it? | Today: two records, partly synced |
| D3 | Who may invite owners, tenants and trustees? (Agency Administrator only, or Portfolio Managers for their own schemes) Invite from the person, unit and board records? | Today: Agency Administrator in Settings only |
| D4 | Configurable role profiles in v1, or the fixed role → permission map? | `docs/08` §8 lists profiles as open |
| D5 | Identity provider and the passkey or step-up approach (WebAuthn server, Humo Mobile push) | Not specified |
| D6 | Can staff hold resident or trustee roles in a scheme they manage (conflict of interest)? | Seed: Sarah is staff *and* a Kingfisher Court trustee |
