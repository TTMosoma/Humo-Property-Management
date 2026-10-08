# 03 — Identity, access and security

Status: **Implemented in the frontend prototype (mock behaviour only).** Decisions marked ⚑ need product-owner approval.

This document describes how Humo decides who someone is, what they can do, where they can do it, and what they did. The UI follows this model, but **the UI is not the security boundary**. The future .NET API enforces every rule on every request.

---

## 1. The model

```
Identity → Role (active assignment) → Permissions → Scope → Entitlements → Context → Audit
```

| Layer | Question | Where it lives |
|---|---|---|
| **Identity** | Who is the authenticated person? | `Identity` (`domain/models/identity.ts`). There is exactly one per human, with a status (invited, active, suspended, deactivated) and `OrganisationMembership`s. |
| **Role** | Which hat are they wearing right now? | `RoleAssignment.role`. A person holds several and switches between them. |
| **Permissions** | What can that role do? | `ROLE_PERMISSIONS` and `PERMISSIONS` (`domain/models/permission.ts`), plus individual `grants`. |
| **Scope** | Where can they do it? | `RoleAssignment.scope`: an explicit type (`platform`, `organisation`, `schemes`, `unit`, `party`) with `organisationId`, `schemeIds`, `unitId` or `partyId`. |
| **Entitlements** | Does the customer's plan include the feature? | `PLAN_FEATURES` (`domain/models/entitlement.ts`). |
| **Context** | What is in focus right now? | Active assignment plus the scheme scope chip (`ScopeService`). |
| **Audit** | What did they actually do? | `AuditEvent` (`domain/models/audit.ts`). It is written by the API, never by the browser. |

Two principles run through it:
- **Role determines what someone can do. Assignment determines what they can see.**
- **The UI hides what is unavailable; the API refuses it.**

## 2. One identity, many roles

Sarah Jacobs has **one** identity with four assignments:
- Portfolio Manager for Protea Gardens, Parkhurst Lofts and Greenstone Commons
- Finance User for all schemes
- Agency Administrator for Acacia
- Trustee of Kingfisher Court

**Switch role** (from her name in the top bar):
- **Identity:** stays the same; only the active assignment changes.
- **Server:** the API confirms she holds the assignment (`AccessDataSource.switchRole`) and records a security event.
- **App:** navigation, queues, quick actions, available actions, scope and the home route all follow the new role.
- **Acknowledgement:** a calm strip in the role's accent colour says "You're now working as Finance User · All schemes in Acacia… You're still signed in as Sarah Jacobs."
- **Wording:** we say "Switch role", never "Switch account". Every role uses the same brand accent; roles differ by label, context and navigation (see `docs/06-experience-review.md`). Red is reserved for impersonation.

### Roles

| Customer roles (granted by Agency Administrator) | Humo internal roles (granted by a Humo System Administrator) |
|---|---|
| Agency Administrator · Portfolio Manager · Finance User · Operations / Maintenance · Trustee · Owner · Tenant · Supplier / Contractor | Humo System Administrator · Humo Account Manager · Humo Support · Humo Executive |

**Granting roles:**
- Humo roles never appear in customer screens, and the customer-side picker cannot offer them.
- **Nobody can change their own roles.** The UI blocks it and the mock API refuses it too.
- Granting **Agency Administrator** is the "add an administrator" step-up action.

## 3. Permissions

- **Permission names** are the contract with the future API's authorisation policies. Examples: `Payables.Release`, `Users.ManageAdmins`, `System.Impersonate`.
- **Default sets:** each role has a fixed set. The full matrix is shown in **Settings › Roles & permissions**.
- **Permission attributes:** each permission is marked `mutates`, which is blocked in Observe impersonation, and/or `stepUp`, which needs fresh verification.
- **`System.Impersonate`** is in **no** role's defaults. It is granted to named individuals: Terry has it; Nomsa (also a System Administrator) does not.
- **Feature code** asks `session.can('Maintenance.Manage')` and similar, rather than testing role names.

⚑ **Decision — routes stay role-gated for now.** Pages and navigation are still declared per role, plus a `feature` entitlement where relevant. Actions are permission-gated. Moving route guards to permissions is easy once the API's policy names are final.

## 4. Scope and context

- **Scope by assignment:** scope follows the assignment exactly. An empty `schemeIds` means the whole agency.
- **Pinned schemes:** saved per assignment, so Sarah's Portfolio Manager pins are not her Finance pins.

⚑ **Decision — this changes earlier behaviour.** Portfolio managers used to see the whole agency so they could cover for colleagues. They now see only their assigned schemes. Covering for a colleague should be an extra, ideally time-limited, assignment.

## 5. Entitlements

- **Plans:** Starter, Professional and Enterprise each include a feature set (`PLAN_FEATURES`).
- **In the app:** navigation hides features the plan excludes. The route guard sends deep links to a "Not included in your plan" page.
- **Shown in:** the Roles & permissions page lists the plan.
- **Server:** the API must check entitlements on every request as well.

## 6. Step-up authentication

**Methods: first-party and device-native only.**
- **Passkeys:** Windows Hello, Face ID, Touch ID and phone screen lock, via WebAuthn later.
- **Humo Mobile approval:** includes **number matching**, which defeats push-fatigue attacks.
- **No third-party authenticators:** there is no dependency on Google Authenticator or TOTP codes.

**Actions that ask:**
- Releasing a supplier payment
- Approving amounts of **R 50 000 or more** ⚑
- Changing supplier banking details
- Changing anyone's roles
- Adding an administrator
- Exporting sensitive data (for example the audit log)
- Changing your own security settings
- Starting Act-mode impersonation

**Freshness:** a proof stays fresh for **5 minutes** ⚑, so a run of related actions asks once.

**How it is wired:**
- **UI:** `StepUpService.guard(request, action)` opens the dialog only when needed. The dialog says what is being verified and why; it has passkey, waiting, number-match, verified and failed states.
- **Mock API:** `MockGateway` refuses a sensitive command without a fresh proof (`step-up-required`). Every attempt is audited.
- **Backend later:** WebAuthn challenge/assertion, a signed push to Humo Mobile, and the proof's time and method carried on the session (`acr` and `auth_time`).

## 7. Impersonation

| | Role switching | Impersonation |
|---|---|---|
| Meaning | "I am Sarah, operating as Finance User." | "I am Terry, viewing Humo Property Management as Sarah." |
| Who | Anyone with more than one role | Only identities granted `System.Impersonate` |
| Visual | Quiet role accent | Orange banner, orange frame around the whole app, "Impersonating" badge, Exit button |

**Starting it (Platform › Users & impersonation → View as…), Terry chooses:**
- **The target's role** to view as. The session is pinned to that one assignment.
- **The mode:**
  - **Observe:** read-only.
  - **Act:** requires a case reference, a note and step-up.
- **The reason:**
  - Customer support investigation
  - Bug reproduction
  - Security investigation
  - Data correction
  - Other (requires a note)

He must also acknowledge that the customer's administrators can see the session.

**Observe mode is enforced twice:**
1. **UI:** `session.can()` drops every mutating permission, so actions disappear.
2. **Mock API:** `MockGateway` refuses any write with `observe-only` and audits the attempt. The message is "Observe mode is read-only. Nothing was changed — the attempt was logged."

**Other rules:**
- Humo staff cannot be impersonated.
- While impersonating, the target's own Security settings are hidden.
- A step-up is always for the actor (Terry), never the target.

**Transparency ⚑:**
- The customer's Agency Administrator sees every Humo session in **Settings › Audit log › Humo access**.
- A summary banner says how many times Humo staff opened their agency.

## 8. Audit

`AuditEvent` captures the following:

| Field | What it holds |
|---|---|
| Timestamp | When it happened |
| Actor | The human at the keyboard |
| Acting as | The impersonated user, when impersonating |
| Role | The role used |
| Organisation | The agency |
| Scope | The scheme in focus |
| Action | What was done |
| Resource and resource ID | What it was done to |
| Amount | When money is involved |
| Result | Success, denied or failed, with the reason |
| Step-up | Method and device |
| Impersonation | Mode, reason and note |
| Session | IP, device and session ID |

An example from the prototype:

> 17:45 · **Terry Mosoma as Priya Naidoo** · Finance User · Acacia Managing Agents
> Approved payment batch PB-0412 · R 58 940.20 · Passkey (Windows Hello · Studio laptop) · Act · Data correction · HUMO-2331

**Screens:**
- **Settings › Audit log** (agency admins): Activity, Security and Humo access tabs, plus search, a "denied or failed" filter, expandable details and a step-up-protected CSV export.
- **Platform › Audit log** (Humo): every agency, with an agency filter.

## 9. Where things live (frontend)

| Concern | Files |
|---|---|
| Models | `domain/models/role.ts`, `persona.ts` (Identity, RoleAssignment), `permission.ts`, `entitlement.ts`, `security.ts`, `audit.ts` |
| Ports | `domain/ports/access-data-sources.ts`: `AccessDataSource`, `AuditDataSource`, `SecurityDataSource`, `StepUpAuthenticator`, `PolicyError` |
| Session | `core/session/session.service.ts` (actor vs persona, `can`, `readOnly`, `hasFeature`, `stepUpFresh`), `core/session/role-switcher.ts` |
| Security UX | `core/security/step-up.service.ts`, `step-up-dialog.*`, `impersonation.service.ts`, `impersonation-banner.ts`, `policy-notices.ts` |
| Mock API boundary | `mock/server/mock-gateway.ts`: authorise, Observe, step-up, audit |
| Mock stores | `mock/db/access-store.ts`, `mock/db/seed-audit.ts`, `mock/data-sources/in-memory-access-data-sources.ts` |
| Screens | `features/security/security-page`, `features/access/users-page` + `access-drawer`, `features/access/roles-page`, `features/audit/audit-page`, `features/platform/platform-users-page` + `impersonate-dialog` |

## 10. What the backend must do

1. **Identity provider:** WebAuthn passkeys (registration and assertion), Humo Mobile push with number matching, trusted devices and session management.
2. **Tokens:** carry the identity, the active assignment and the step-up level and time.
3. **Authorisation:** policies named after `Permission` values, evaluated against the active assignment's role and grants. Scope filters apply in every query; entitlement checks apply per feature.
4. **No self-escalation:** role grants are checked against the role hierarchy, and self-grants are refused.
5. **Impersonation sessions:** server-side and time-limited, carrying both identities. Act requires a fresh step-up; Observe rejects all writes.
6. **Audit store:** append-only, written in the same transaction as the command, including denied attempts, and exportable.
7. **Dual control:** money-moving approvals must refuse **approver = preparer**. The prototype doesn't enforce this yet: Priya's role can approve a batch she prepared.
