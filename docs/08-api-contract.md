# 08 — Frontend contract for the .NET backend

Status: **frontend contract frozen after the P1 and P2 readiness cleanups** (October 2026). This is what the Angular app expects from the API. The domain models (`domain/models`) and ports (`domain/ports`, `domain/contractor`) are the draft contract; this document records the decisions that aren't obvious from the types.

## 1. How the app talks to the backend

- Every screen depends on an abstract **port** (`XxxDataSource`), never on a store or fixture. `mock/provide-mock-data.ts` binds the ports to in-memory adapters. A `provideHttpData()` will bind the same ports to HTTP adapters, and no component changes.
- **Queries** return read models that are already joined (`UnitSummary`, `JobDetail`, `QuoteRequestView`…). Each one is a query endpoint.
- **Commands** are named actions (`JobAction`, `assign`, `endAssignment`, `changeSubscription`…). Each one maps to an Application-layer command. Commands return `void` or the new id.
- `mock/server/mock-gateway.ts` shows the checks every command goes through, in order:
  1. Observe impersonation (read-only)
  2. Permission
  3. Entitlement
  4. Version (409)
  5. Validation (422)
  6. Step-up freshness: checked **after** validation, so nobody verifies with a passkey for a request that was going to fail
  7. Audit

- **Step-up is a challenge, not a refusal.**
  - When a valid command needs a fresh proof, the API answers `step-up-required` and changes nothing.
  - The client verifies (passkey or Humo Mobile) and sends the same command again.
  - Forms do this through the form drawer: send first; on `step-up-required`, verify and resend; cancelling leaves the form as it was.
  - Only the outcome of the retried command is audited.
  - One-click actions without typed input (approve, release a batch) may still verify first.
  - (H-2, fixed 10 Oct 2026.)

## 2. Session bootstrap: `GET /me`

`SessionDataSource.current()` returns a `CurrentSession`:

- **People:** `actor` (the human at the keyboard), `identity` (whose app it is: the actor, or the person being impersonated) and `impersonation`.
- **Roles:** `assignments` (the ones they can switch between) and `activeAssignmentId`.
- **Permissions:**
  - `permissions`: what the active assignment may do right now, already limited by Observe mode.
  - `pagePermissions`: the same before Observe limits, which decides the pages it may open.
  - `actorPermissions`: the actor's own, for example `System.Impersonate`.
- **Access is by permission, never by role.** Routes declare `data.permission`; navigation entries name the same permission.
- **Organisation and plan:** `organisation`, `subscription` and `entitlements` (a plain `Entitlement[]`).

**The server computes all of it.** The client never derives permissions from `ROLE_PERMISSIONS` or resolves entitlements itself. Those tables remain in the client only to explain things (Roles & permissions, Plan & features).

| Session change | Command | Then |
|---|---|---|
| Switch role | `AccessDataSource.switchRole(assignmentId)` | Issue a token scoped to the assignment; `/me` reflects it |
| Impersonate | `startImpersonation` / `endImpersonation` | The server session holds the impersonation; ending always succeeds |
| Sign out | `signOut(product)` | Ends the Humo session for every product; the browser forgets it even if the call fails |
| Sign in | Identity provider redirect (passkey or Humo Mobile) | `SessionDataSource.signIn` is a prototype stand-in |
| Scheme rules and breaches (doc 15 §6, D29) | `GET /rules/{schemeId}`; `POST /rules/{schemeId}/actions` (add, amend, repeal, share); `POST /rules/{schemeId}/upload` (multipart: `adoptedOn`, `resolutionRef`, `shareWithOwners`, `file`); `GET /breaches?schemeIds=…`; `GET /breaches/{id}`; `POST /breaches`; `POST /breaches/{id}/actions` `{ action, expectedVersion }`. All need the `scheme-rules` feature (`403 not-entitled`, reading too) | `RulesDataSource` |
| Add a passkey (D30) | `POST /me/passkeys/options`, then `POST /me/passkeys` `{ credential, tool }`. `403 step-up-required` if they have a passkey and haven't confirmed with it in the last 5 minutes; `400 passkey-rejected` if the credential is refused | `SecurityDataSource.addPasskey`, `SessionDataSource.registerPasskey` |

For HTTP, add an app initializer that waits for the first `/me` response before the shell renders.

## 3. Organisations, people and access

```
Identity (status: invited | active | suspended | deactivated)
  → OrganisationMembership (organisationId, status: active | suspended | ended, since)
    → RoleAssignment (role, scope, status: active | ended, grantedBy/At, endedBy/At, validUntil)
```

- **Organisation, not agency.** Contracts say `organisationId`; screens say "Agency". `Organisation` has a `kind` (`managing-agency` today) and a `status` (`onboarding | active | suspended | archived`). That status is separate from the subscription's commercial status.
- **Scope is explicit:** `{ type: 'platform' | 'organisation' | 'schemes' | 'unit' | 'party', organisationId, schemeIds, unitId?, partyId? }`. "All schemes" is `type: 'organisation'`, never an empty list.
- **Nothing is deleted.**
  - Ending an assignment sets `status: 'ended'`; Users & access shows ended roles as history.
  - Granting a role in an organisation creates (or keeps) the membership.
- **Scheme managers are derived.** `Scheme.portfolioManager` is a read-only join from active portfolio-manager assignments; the longest-standing one wins.
- **Schemes have a lifecycle:** `prospect | onboarding | active | closed | archived`.
- **Names come from the directory, not fixtures.** Assignee pickers and names use `AccessDataSource.directory()` (`core/session/team.ts`).

**The server must scope every query.** Client parameters such as `schemeIds` only narrow the result; the server intersects them with the token's scope. `SchemeDataSource.list()`, `WorkItemDataSource.watch()` and `NotificationDataSource.list()` must return only what the caller may see.

## 4. Errors

Every port reports failures as `ApiError` (`domain/ports/api-error.ts`):

| HTTP | `kind` | UI |
|---|---|---|
| 400 / 422 | `validation`, with `fieldErrors` | The message appears next to the field (`<ui-field-error>`) and the form keeps what was typed |
| 401 / 403 | `policy`, a `PolicyError` with code `observe-only` / `forbidden` / `step-up-required` / `not-entitled` | `PolicyNotices` explains why (it becomes the HTTP interceptor). `step-up-required` is answered by verifying and resending (§1), not shown as an error. |
| 404 | `not-found` | A "couldn't find" empty state |
| 409 / 412 | `conflict` | "Someone else changed it — reload and try again" |
| 503 with a `title` | `unavailable` | A service the API needs is down for now (the virus scanner, say): the API's own message is shown |
| 0 / 5xx | `network` / `server` | Error state with **Try again** |

Use ProblemDetails, with a `code` for policy errors and an `errors` map keyed by field name. The field names match the command's input (`title`, `location`, `unit`, `amount`, `completeBy`…).

## 5. Loading and refreshing

- **Page state comes from the request.**
  - Pages use `loadable(() => port.query(...))` (`core/data/loadable.ts`) for loading, ready and error, and **Try again** sends the request again.
  - There is no simulated page state. The prototype's state simulator now lives in the mock network (`mock/mock-latency.ts`).
- **Queries are live.**
  - Ports promise to emit again when their data changes. In memory, that happens automatically.
  - Over HTTP, commands announce what they changed (`DataChanges.notify('receipts', 'accounts')`) and queries re-fetch on those topics (`liveQuery`, `core/data/data-changes.ts`).
  - Push (SignalR) is needed only for other people's changes to work items and notifications.

## 6. Contact details (Humo Contractor)

`BusinessParty.contact` is **optional and sent only when disclosure allows it**:

- to the business itself
- to a customer that already works with it
- after the customer accepts its quote

`QuoteRequestView.disclosure[partyId]` tells the UI why. `SupplierDataSource.linkParty` doesn't take contact details: the server copies them from the party.

## 7. Lists, versions, money and the catalogue (P2)

- **Long lists are paged.**
  - Audit, platform customers, receipts, jobs, people and units take an optional `ListQuery` (`q`, `filters`, `sort`, `page`, `pageSize`) and return `Page<T>` (`items`, `total`, `page`, `pageSize`).
  - Screens don't send a page size yet and filter in the browser; the in-memory adapters apply only paging.
  - When a list outgrows the browser, the screen passes its URL state through as the query.
- **Optimistic concurrency.**
  - `Job`, `Invoice`, `PaymentBatch`, `Receipt`, `Subscription` and `RoleAssignment` carry a `version`.
  - Commands that change them take `expectedVersion`: `JobDataSource.act`, receipt allocation, `releaseBatch`, `cancelBatch`, `changeSubscription` and `endAssignment`. A stale version gets **409**, which the UI shows as "someone else changed it first".
  - Only the first of a chain of job commands carries the version.
- **Files from commands.** A command that produces a file answers with the file (`Content-Disposition` names it): the audit export, and releasing a payment batch, which returns the payment file for internet banking (`POST /payables/batches/{id}/release`, D27). The adapter saves it in the browser and returns its name. A refusal still comes back as ProblemDetails, so step-up works as usual.
- **Suppliers on a job.** `GET /jobs/{ref}` returns `candidates`: the agency's suppliers serving the job's scheme, of every trade. The screen shows those for the trade picked at triage, so changing the trade changes the list before it's saved.
- **Supplier vetting documents.** A supplier's `documents` always lists every vetting document; one with no record is `onFile: false`. `POST /documents/library` with `recordKind=supplier` and `supplierDoc` records it, needs `Suppliers.Manage`, and needs `expiresAt` for everything but the bank letter. That document can't be archived or have its date changed: a new upload replaces it.
- **The board's approval (D39).** An approval above the scheme's limit, an invoice above its quote and above the limit, and a written resolution have `board` on the work item (`trustees`, `needed`, `approvals`, `rejections`, `seats`, `mySeat`, `iVoted`) and only `trustee` in `approverRoles`. A trustee's `POST /work-items/{id}/decision` is one vote; the item is decided when a majority of the board register agrees. `POST /work-items/{id}/board-approval` (multipart: `file`, `signers`, `signedOn`, passkey) records trustees' signed approval; every trustee on record is told. `POST /schemes/{id}/delegated-limit` (`limit`, passkey) sets a scheme's limit, which `SchemeDto.delegatedLimit` carries. The job action `change-priority` (`priority`, `reason`) works at any stage until the job is closed or cancelled. The job action `emergency-proceed` (`quoteId`, `reason`, passkey) goes ahead on an urgent job; the job's `emergency.status` is `to-confirm` until the board decides, and its invoice can't go into a payment batch until then.
- **Correcting quotes (D41).** `record-quote` records an amount once; a received quote changes only by `correct-quote` (`quoteId`, `amount`, `reason`) while collecting quotes, waiting for approval (which it withdraws) or approved before the work order (a lower price stands; a higher one reopens quotes). `request-revision` (`quoteId`, `reason`) asks the same supplier again; `reopen-quotes` (`reason`) withdraws an approval. A quote carries `versions` (amount, at, by, reason), `rejectedReason`, and the statuses `revision-requested` and `rejected`. A withdrawn approval has the status `withdrawn`.
- **Account corrections (D40). `POST /accounts/{id}/corrections` (multipart: `kind` = `reversal` or `write-off`, `amount`, `lineId` for a reversal, `reason`, optional PDF) puts an `account-correction` approval in My work: a reversal for Agency Administrators and Finance other than whoever prepared it, a write-off for the board (`board`, D39). Approved, it's posted as an adjustment linked by its reference. `POST /accounts/{id}/adjustments` now refuses a credit. The collection action `resolve-dispute` takes `outcome` = `stands`, `paid` (`lineId` of a payment), `reversal` (`lineId`, `amount`) or `write-off` (`amount`), and the case carries `resolving` while it waits.
- **Technical logs.** `POST /platform/logs/query` (`date`, `level`, `search`) and `POST /platform/logs/download` (`date`, passkey): `Platform.Logs`, System Administrators only, never while impersonating. Both are in the audit log. Files are on disk, one a day, kept for 30 days (`Logs__Directory`, `Logs__RetainDays`).
- **Job photos** (D37). `POST /jobs/{ref}/photos` takes multipart (`file`, `stage` = `report` or `completion`, optional `caption`). `GET /jobs/{ref}/photos/{id}` returns the image to whoever can see the job. `DELETE /jobs/{ref}/photos/{id}` removes the photo and its file, which frees the storage; a resident removes only photos they added. A refusal (not an image, HEIC, too large, infected, over the storage limit) is ProblemDetails whose `errors.file` says why, and the screen shows that sentence.
- **Money** is rands as JSON numbers with at most two decimals (`decimal` / `DECIMAL(18,2)` on the server).
  - The server computes every total that matters.
  - The browser adds amounts only for display, through `sumRands` (in cents) (`domain/models/money.ts`).
- **Time** is ISO 8601: instants with an offset (`2026-10-08T09:30:00+02:00`), calendar dates as plain dates. Screens show local time.
- **Catalogue.**
  - `CatalogueDataSource.catalogue()` (GET /catalogue) publishes features, packages and add-ons. `CatalogueService` (`core/catalogue`) loads it once for names, package contents and module rows.
  - Feature *keys* stay in code, because the app gates on them. Names and packaging are data.
  - The domain constants are now only the mock server's seed.
- **Prototype tools** (the toolbar, "Sign in as", the state simulator and nudge reset) appear only when the data layer provides `PrototypeControls`. `provideMockData()` provides it; the HTTP data layer won't.

## 8. Still open

- Custom (configurable) role profiles: the permission model is ready, but there's no UI to edit them.
- A push channel (SignalR) for work items and notifications changed by other people.
