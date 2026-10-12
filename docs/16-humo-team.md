# 16 — Humo team management (fix before Checkpoint 11)

Status: **implemented in the frontend simulation** (October 2026).

**The gap:** Humo's own staff couldn't be managed in the app. The roles and the `Platform.ManageHumoRoles` permission existed, but the *Humo team* tab on Users & impersonation was read-only, and the team was hard-coded in the seed. Two account managers named on customers (Thabo Mahlangu, Carla de Wet) had no identity at all.

## Where

**Platform › Humo team** (`/platform/team`, and `/platform/team/:identityId` for each person).
- **Who can see it:** every Humo role (`Platform.View`).
- **Who can change it:** System Administrators only (`Platform.ManageHumoRoles`), while working in that role. A System Administrator working as Executive is told to switch roles first.
- **Users & impersonation** now links to it.

Humo staff work across every Humo product, so the team belongs to the Humo platform (doc 07). When a separate Humo console exists, this page moves there.

## Lifecycle

| Action | What happens | Rules |
|---|---|---|
| **Invite** | Name, Humo email, job title, role, what they do, why. They're *Invited* with no passkey or sessions until they accept and set up a passkey. | Email must be `@humo.example` (prototype domain) and unused. Humo staff can never be invited into an agency: agency invites, and edits of an agency user's email, refuse any `@humo.example` address (fixed 10 Oct 2026; before, only addresses already belonging to a Humo identity were refused). |
| **Edit details** | Name, Humo email, job title. | Version-checked (409). |
| **Give a role** | Account Manager, Support, Executive apply at once. | **System Administrator** creates a request that a *second* System Administrator approves or declines on the team page. The requester can't approve their own request, and nobody can approve a request about themselves. |
| **End a role** | Kept in their history. Ending System Administrator also ends impersonation and signs them out. | Not the last active System Administrator. An Account Manager's role can't end while they still look after customers. |
| **Impersonation** | Allow or withdraw `System.Impersonate`, an individual grant on the System Administrator role. | System Administrators only. |
| **Delegated account activation** (added 11 Oct 2026) | Grant or revoke `Platform.Customers.ActivateWithoutApproval`, an individual grant on the Account Manager role: they activate new customer accounts without a separate approval. The member page also lists what each person can do, marking individual grants. | Account Managers only. See doc 21. |
| **Customers** | Choose the customers an Account Manager looks after; choosing one moves it from its current manager. | Every customer always has an account manager. |
| **Suspend / restore** | Suspended: signed out everywhere, can't sign in. Roles and customers stay. Restore returns to the status held before suspension (`Identity.suspendedFrom`): an invitee who never accepted goes back to *Invited*, not *Active* (fixed 10 Oct 2026). | Not the last active System Administrator. |
| **Offboard** | Every Humo role ends, status *Deactivated*, sessions end, pending requests are withdrawn, and their customers move to the account manager chosen in the form. They show under *Former*. | Not the last System Administrator. Customers must be reassigned. |

**For every change:**
- **Re-verification:** a fresh step-up (new sensitive action `change-humo-team`).
- **A reason:** required.
- **The audit log:** each change is recorded in the platform audit log, including refused attempts.
- **No self-service:** nobody changes their own access.

## API (for the backend)

| Endpoint | Purpose |
|---|---|
| `GET /platform/team`, `GET /platform/team/{id}` | Members, with roles, impersonation and customers. |
| `GET /platform/team/pending-grants` | System Administrator requests waiting for approval. |
| `POST /platform/team` | Invite. |
| `PATCH /platform/team/{id}` | Details. |
| `POST /platform/team/{id}/actions` | `grant-role`, `end-role`, `set-impersonation`, `set-delegated-activation`, `set-customers`, `suspend`, `restore`, `offboard`, `approve-grant`, `decline-grant`. |

The server enforces every rule above, whatever the screen shows.

## Small fixes made along the way

- **Accepting an invitation** (simulated) now adds the passkey and first session it describes.
- **New invitees** start with an empty security profile; before, every new identity got demo sessions.
- **Seed identities** added after a simulation was saved (Thabo, Carla) join the saved simulation on load.
