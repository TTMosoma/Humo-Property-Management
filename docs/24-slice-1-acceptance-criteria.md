# 24 — Slice 1 acceptance criteria: tenant and portfolio foundation

Status: **extracted 18 October 2026** from the simulated API (`frontend/humo-web/src/app/mock/`). Audit item R3 / P1-8.

**Why this exists:** the mock stores are the specification (audit F-11). The .NET backend replaces them, so every rule they enforce is written here. A slice-1 endpoint is done when each applicable rule below holds **in the API**, with the same outcome and the same field and message.

**Related:**
- [08-api-contract.md](08-api-contract.md): conventions.
- [17-decisions.md](17-decisions.md): D1–D6.
- [16-humo-team.md](16-humo-team.md): the Humo team.
- [21-account-creation-and-approval.md](21-account-creation-and-approval.md): new customer accounts.
- [audit/backend-readiness-and-prioritised-roadmap.md](audit/backend-readiness-and-prioritised-roadmap.md) §4: slice 1's scope.

**Executable specification:** each "Test" below names a spec in `frontend/humo-web/src/app/mock/**`. Those specs run against the in-memory adapter today. Run them against the HTTP adapter as each port is swapped (P1-1 contract tests).

---

## 1. Every command (the pipeline)

The order matters: nobody verifies a passkey for a request that was going to fail.

| # | Rule | Outcome |
|---|---|---|
| C1 | In **Observe** impersonation, writes are refused, except ending the impersonation | 403 `observe-only`, audited as denied |
| C2 | The **permission** comes from the token's active assignment (role permissions plus individual grants), never from the client | 403 `forbidden`, audited |
| C3 | The **entitlement** (`resolveEntitlements`) must include the command's feature | 403 `not-entitled`, audited |
| C4 | **Scope (D1).** A command naming a scheme outside a scheme-scoped assignment is refused, even when the person may browse it. Organisation-wide and Humo assignments aren't limited here. | 403 `out-of-scope`, audited |
| C5 | **Optimistic concurrency.** If the client sends the version it saw and the record has changed since | 409 `conflict` ("Someone else changed this first") |
| C6 | **Validation** runs after authorisation | 422 with `fieldErrors` (field → message, as listed below) |
| C7 | **Step-up.** Sensitive commands need a fresh proof, within 5 minutes (`STEP_UP_FRESH_MS`). The default comes from the permission's `stepUp` flag; a command may force or waive it. Step-up is checked **after** validation. | 403 `step-up-required` (a challenge: the client verifies and retries; not audited) |
| C8 | **Domain refusals** inside the command, e.g. self-escalation, or a staff trustee approving their agency's work (D6: `conflict-of-interest`) | 403 with a reason, audited as denied |
| C9 | **Audit.** Every success and refusal is appended. Each record holds the actor and the impersonated user, role, organisation, action, resource, result, reason, step-up method and session. Nothing is ever deleted. | |

**Tests:** `subscription-changes.spec`, `scheme-scope.spec`, `account-approval.spec`.

## 2. Reads and the session

| # | Rule |
|---|---|
| S1 | **`GET /me`** returns:<br>• actor and identity (different while impersonating);<br>• assignments and the active one;<br>• permissions, page permissions and actor permissions;<br>• organisation;<br>• subscription and entitlements;<br>• impersonation.<br>The client never computes permissions or entitlements. |
| S2 | **No session means signed out.** The SPA shows sign-in (implemented: `HttpSessionDataSource`). |
| S3 | **Blocked sessions.** A suspended or deactivated person can't work: `blocked: identity-suspended / identity-deactivated`. Nor can anyone in a suspended or archived organisation: `organisation-suspended`. |
| S4 | **Reads derive scope from the token.** A `schemeIds` parameter only narrows within it (docs/08 §2). |
| S5 | **D1 browsing.** `Portfolio.BrowseAgency`, an individual grant on a scheme-scoped staff role, lets the person **read** every scheme in their agency. Writes stay limited by C4. |
| S6 | **Unknown or out-of-scope records** answer "not found", never "forbidden", so the names of other bodies corporate don't leak. |

## 3. Organisations (Humo staff)

| Field / action | Rule | Message |
|---|---|---|
| `name` | At least 3 characters | Enter the registered name. |
| `shortName` | At least 2 characters; unique across customers (case-insensitive) | Enter the name people use day to day. / Another customer already uses this name. |
| `city` | At least 2 characters | Enter the city. |
| `province` | One of the nine provinces | Choose the province. |
| Edit | `Platform.Customers.Manage`, version-checked | |
| Status | Allowed moves:<br>• onboarding → active / suspended / archived<br>• active → suspended / archived<br>• suspended → active / archived<br>• archived → active<br>Needs a reason. **Suspend and archive need step-up.** | A {from} organisation can't be moved to {to}. |
| Effect | Suspended or archived: nobody in it can work (S3). | |

**New customer accounts** are requests, approved or activated under delegated authority (doc 21). The sole-administrator safeguard is in doc 16 §"Sole-administrator safeguard". **Tests:** `account-approval.spec`, `sole-admin.spec`.

## 4. Schemes

| Field / action | Rule | Message |
|---|---|---|
| `name` | At least 3 characters | Enter the scheme's name. |
| `code` | 2–4 capital letters; unique within the organisation. It starts every account number. | Use 2–4 letters, e.g. KC… / Another scheme already uses this code. |
| `type` | Sectional title, HOA or share block (`TYPES`) | Choose the type of scheme. |
| `suburb`, `city` | At least 2 characters | Enter the suburb. / Enter the city. |
| `province` | One of the nine | Choose the province. |
| Add / edit | `Schemes.Manage`, version-checked on edit | |
| Status | Allowed moves:<br>• prospect → onboarding / archived<br>• onboarding → active / archived<br>• active → closed<br>• closed → active / archived<br>• archived → closed<br>Needs a reason (at least 5 characters). | A {from} scheme can't be moved to {to}. |
| Archive | Refused while any account in the scheme owes money | Some accounts still owe money. Settle or hand them over before archiving. |
| Portfolio manager | The longest-standing active portfolio-manager assignment covering the scheme, from **live** assignments (P0-5) | |

## 5. Units

| Field / action | Rule | Message |
|---|---|---|
| Scheme state | No changes in a closed or archived scheme | {Scheme} is {status}; reopen it to change its units. |
| `number` | 1–6 letters, digits or dashes; unique in the scheme | Use the unit number as people say it, e.g. 42 or 12B. / There's already a unit {n} in {scheme}. |
| `description` | At least 2 characters | Describe the unit, e.g. 2-bed apartment. |
| `participationQuota` | More than 0 and up to 100 (percent) | Enter the participation quota as a percentage (0–100). |
| `monthlyLevy` | At least 0 (rand) | Enter the monthly levy in rands. |
| Levy in a budget scheme (D13) | Can't be edited per unit: it comes from the applied levy roll | This scheme's levies come from its approved budget… |
| `occupancy` | One of the allowed values | Choose who lives there. |
| Add / edit | `Units.Manage`; scope C4 | |

## 6. People and relationships

| Field / action | Rule | Message |
|---|---|---|
| `firstName` (individual) | Required | Enter their first name. |
| `lastName` | At least 2 characters (a company's registered name) | Enter their surname. / Enter the registered name. |
| `email` | Valid if given; unique in the directory | That doesn't look like an email address. / Someone else in the directory already has this email. |
| Contact | At least a phone number or an email address | Give at least a phone number or an email address. |
| `preferredChannel` | Email preferred needs an email address | Email is preferred, but there's no email address. |
| Relationship types | **Owner or tenant only. Trustees come from the board (D2).** | Trustees are appointed on the scheme's board, from a resolution or by co-option. |
| Relationship scheme | Exists, and isn't archived | Choose the scheme. / {Scheme} is archived. |
| Unit | Belongs to that scheme | Choose the unit. |
| Tenant | One current tenant per unit | Unit {n} already has a tenant. End that lease first. |
| Owner | Not twice on the same unit | They already own this unit. |
| Dates | `since` required; `until` on or after `since` | Choose the date it started. / The lease can't end before it starts. |
| End a relationship | The end date is on or after the start; the relationship stays in the history | Choose a date on or after it started. |
| Commands | `People.Manage`; scope C4 | |

**Board (D2):**
- **Appoint:** an owner in the scheme who isn't already a trustee, by election (with a resolution) or co-option. A person with a sign-in **gets trustee access** to that scheme.
- **End a term:** removes that access.
- **Users & access can't grant the trustee role without a current board seat.**
- **Tests:** `trustee-board.spec`.

## 7. Users and access (agency)

| Action | Rule | Message / outcome |
|---|---|---|
| Invite | Permission depends on the inviter:<br>• Humo staff: `Platform.Customers.Manage`, **Agency Administrator role only (F-22)**;<br>• for an Agency Administrator role: `Users.ManageAdmins`;<br>• owners, tenants and trustees: `Residents.Invite`, scope C4 (D3);<br>• other staff roles: `Users.Manage`.<br>**Step-up.** | Onboarding invites the customer’s first Agency Administrator. They invite everyone else. |
| Invite from a record (D3) | `personId` links the sign-in to the People record. Trustee: a current board seat. Owner or tenant: a current link to that unit. | {Name} isn’t on that scheme’s board… / {Name} isn’t a current {role} of that unit. |
| Invite `name` | First name and surname | Enter their first name and surname. |
| Invite `email` | Valid | Enter the email address the invitation goes to. |
| Invite `email` | Not a Humo staff address (`@humo.co.za`), and not an existing Humo identity | That's a Humo staff address… |
| Invite `email` | Not already a member here | {Name} already has access here. Add the role from their access instead. |
| Scope | Scheme-scoped roles: at least one scheme. Resident roles: a unit. | Choose at least one scheme. / Choose the unit. |
| Edit identity | Email unique across all identities; customers can't take a `@humo.co.za` address | Someone else already signs in with this email. |
| Membership | `active` / `suspended` / `ended`. Not the same status again; not after it ended. **Step-up.** | They aren't a member… / Their membership has already ended. / Their access is already {status}. |
| Give a role | Same permission rule as invite; **step-up**; no duplicates | {Name} already has this role here. |
| Trustee role | Only with a current board seat (D2) | {Name} isn't on that scheme's board… |
| Browse every scheme (D1) | `Users.Manage`, **step-up**. Only on a staff role limited to some schemes. | Only staff roles limited to some schemes… |
| End a role | Ends; kept in the history; never deleted. **Step-up.** | |
| Self | **Nobody changes their own roles, grants or membership** | 403 `forbidden`, audited |
| Switch role | Only to one of your own active assignments. The API issues a token scoped to it. | 403 Not one of your roles |

**First administrator:** onboarding invites the customer's first Agency Administrator, and only that role (F-22). **Tests:** `resident-invites.spec`.

## 8. Humo team, impersonation and audit

- **Humo team:** see doc 16 for every rule:
  - invites only at `@humo.co.za`;
  - a System Administrator role needs a second System Administrator (with the sole-administrator safeguard);
  - the last System Administrator can't be removed;
  - an Account Manager can't leave while they still look after customers.
- **Impersonation:**
  - **Who:** only a System Administrator with the individual `System.Impersonate` grant, and only of a customer identity.
  - **Act** mode needs a fresh step-up; **Observe** doesn't, but refuses all writes (C1).
  - **Reason:** recorded (a reason code, plus an optional ticket and note).
  - **Audit:** start, refusal and end are all audited, the end with its duration.
- **Audit:**
  - **Read:** `Audit.View` (agency) or `Platform.Audit` (all).
  - **Export:** needs **step-up**, and the export is itself audited.
  - **Never edited or deleted.**

## 9. Not in slice 1

- Billing, receipts and payments.
- Maintenance, governance (except board appointments where slice 1 needs them for D2), documents and communications.
- The commercial layer (doc 23).

These modules keep the simulation in development and the demo. In production they answer "not connected" (`provideHttpData`) until their slice lands.
