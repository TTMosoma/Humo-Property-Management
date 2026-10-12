# 17 — Product and architecture decisions (D1–D11)

Status: **approved** on 10 October 2026 by Terry Mosoma (product owner).

**Context:** these are the decisions the current-state audit ([docs/audit/](audit/current-state-summary.md)) identified as blocking backend work.
- **Access and security (D1–D6):** the first backend slice (tenant and portfolio foundation) depends on these.
- **Issued documents and statements (D7–D10):** the billing slice depends on these.

Each entry records:
- the decision;
- what it replaces in the prototype;
- its consequences for the backend and the frontend;
- what's still open.

**Changing a decision:** add a new entry that supersedes it. Don't edit history.

| # | Decision | Blocks |
|---|---|---|
| D1 | Scope by assignment; "browse all schemes" is a grantable permission | Slice 1 |
| D2 | The trustee board is the source of truth; trustee access is derived from it | Slice 1, governance |
| D3 | Portfolio Managers may invite residents and trustees for their schemes; Invite on the person, unit and board pages | Slice 1 |
| D4 | Fixed roles in version 1; every check by permission | Slice 1 |
| D5 | Managed or self-hosted identity provider with passkeys; not built in-house | Slice 1 |
| D6 | Staff may hold owner or trustee roles, but can't approve their own agency's work there | Slice 1, approvals |
| D7 | Issued statements are stored as PDF plus a data snapshot; corrections go on the next statement | Slice 2 |
| D8 | PDFs from headless Chrome in .NET, using the same templates | Slice 2 |
| D9 | Statements are delivered as a portal link by default; attachment is an agency setting | Slice 2, communications |
| D10 | No numbers on statements; gapless numbering only where the law requires it | Slice 2 |
| D11 | Account Managers change their customers' subscriptions without approval; every change is audited with its reason | Platform |

---

## D1 — Scheme scope follows the assignment

**Decision:**
- A role assignment's scope is what the person can see **and** change.
- A Portfolio Manager assigned to some schemes sees only those schemes.
- Seeing every scheme in the agency, **read-only**, is a separate permission (working name `Portfolio.BrowseAgency`). The Agency Administrator grants it individually, for example to a senior manager.
- Changes are always limited to the assignment's scope.

**Replaces:** the scheme resolver's rule that any `portfolio-manager` may open every scheme in the agency (audit F-07).

**Consequences:**
- **Backend:** every read derives scope from the session and every command checks the target record's organisation and scheme. A `schemeIds` parameter from the client is only a filter *within* scope (audit F-02, F-08).
- **Frontend:**
  - The resolver checks scope and the new permission, not the role name.
  - Screens show "read-only" when browsing outside the assignment.
- **Away cover:** cover still hands over the absent person's *work* (docs/15). It doesn't widen the cover's scope.

**Open:** the exact permission name and whether it appears in the role editor (see D4).

## D2 — The trustee board is the source of truth

**Decision:**
- Who is a trustee is the scheme's board register: trustee relationships with an appointment (elected by resolution, co-opted until the next AGM, or in office before Humo Property Management).
- Trustee **access** in Humo PM is derived from it:
  - **Appointing** a trustee who has a Humo sign-in gives them trustee access to that scheme.
  - **Ending** a term removes it, as it already does today.
  - A trustee without a sign-in still counts for quorum and the board's minimum size. They can't approve in the app until invited (D3).

**Replaces:**
- Two partly linked records (audit F-06).
- Adding "Trustee of a scheme" from the People form, which bypasses the board's rules (audit F-28).

**Consequences:**
- **Trustee role assignments** are no longer created by hand in Users & access. They're managed through the board.
- **People:** the People form links someone as owner or tenant only; becoming a trustee goes through the board.
- **Quorum, approvals and votes** all read the board register.
- **Seed data:** the prototype's seed needs reconciling. Sarah Jacobs has trustee access at Kingfisher Court but isn't on its board (see D6). Mpho has trustee access at The Willows without a person record.

## D3 — Inviting residents and trustees

**Decision:**
- **Staff roles** (Agency Administrator, Portfolio Manager, Finance, Operations) are invited by the Agency Administrator only, as today.
- **Owners, tenants and trustees** can be invited by the Agency Administrator **or** by a Portfolio Manager for schemes in their scope.
- **An *Invite* action appears where the work happens:**
  - the person page;
  - the unit page;
  - the trustee board.

  It's prefilled from the record (name, email, unit or board), so nothing is retyped.
- **Bulk invites** (every owner at a scheme, at onboarding) are planned for later.

**Replaces:**
- Invites only from Settings › Users & access.
- "Not invited yet" and "No Humo sign-in" labels with no action (audit F-27, F-40).

**Consequences:**
- **Permissions:** a new permission for inviting residents (working name `Residents.Invite`), held by Agency Administrator and Portfolio Manager.
- **Backend:** checks the scheme or unit is in the inviter's scope (D1).
- **Platform:** the platform's first-administrator invite is restricted to the Agency Administrator role (audit F-22).

## D4 — Fixed roles in version 1

**Decision:**
- Version 1 ships the 12 fixed roles with their fixed permission sets.
- Configurable role profiles are deferred.
- Every check, in the backend and the frontend, is made on a **permission**, never on a role name, so profiles can be added later without changing checks.

**Replaces:** nothing; it confirms the current model. It also requires removing role-name checks used for access decisions (audit F-38), starting with the scheme resolver (D1).

**Open:** when profiles are reconsidered, the role editor and its migration.

> **Correction, 12 October 2026 (Terry Mosoma):** Humo Property Management now has **11** fixed roles, not 12. The decision itself is unchanged: fixed roles in version 1, every check by permission.
>
> **Why:** the Contractor / Supplier role (`supplier`) moved out with Humo Contractor on 11 October 2026 ([20-humo-contractor-separation.md](20-humo-contractor-separation.md)). It belongs to that product, not to Humo PM.
>
> **The 11 roles:**
> - customer: Agency Administrator, Portfolio Manager, Finance User, Operations / Maintenance, Trustee, Owner, Tenant;
> - Humo: System Administrator, Account Manager, Support, Executive.
>
> **Individually granted permissions** (not roles; held by no role by default): `System.Impersonate` on the System Administrator role; `Platform.Customers.ActivateWithoutApproval` on the Account Manager role ([21-account-creation-and-approval.md](21-account-creation-and-approval.md)).

## D5 — Identity provider with passkeys; not built in-house

**Decision:**
- Authentication uses an established identity provider: a managed service, or a self-hosted product.
- Humo doesn't build its own login.

**Selection criteria:**
1. **Passkeys (WebAuthn)** as the primary sign-in, with **step-up**: a fresh proof for sensitive actions, bound to the session.
2. **One Humo sign-in** shared by every Humo product (Property Management, Contractor, future products).
3. **Data residency and POPIA compliance** acceptable for South African customers.
4. **Support for organisation context** (several memberships per identity) and for impersonation by Humo staff with full audit.
5. **Cost per monthly active user** at the expected resident volumes.

**Replaces:** the prototype's persona picker and simulated passkey (audit F-05, F-42).

**Consequences:**
- A short evaluation of candidates (managed: e.g. Microsoft Entra External ID, Auth0; self-hosted: e.g. Duende IdentityServer, Keycloak) against the criteria, before slice 1.
- Humo Mobile push approval is a later addition; passkeys alone cover step-up.

**Open:** which provider (the evaluation's outcome).

## D6 — Staff holding owner or trustee roles

**Decision:**
- Agency staff may also be owners, tenants or trustees, including at schemes their agency manages.
- **As a trustee, a staff member can't approve their own agency's work at that scheme:** quotes and invoices it arranged, its letters of demand, its payment batches.
- The backend refuses such an approval and records the attempt. The approval goes to another trustee.

**Replaces:** no rule today (Sarah Jacobs holds both roles at Kingfisher Court).

**Consequences:**
- **Approvals:** need to know the requesting agency and the approver's employer.
- **Quorum:** the board still counts the person.
- **Domain check:** to be confirmed with a sectional-title governance expert, in particular how such a trustee votes on agency matters at meetings.

## D7 — Issued statements are fixed

**Decision:**
- When a statement is issued (billing run *Send statements*, or a re-send), Humo PM stores:
  - **the PDF**;
  - **a snapshot of its inputs:** ledger lines, holder, address, trust account, template version, branding;
  - **a content hash.**
- Opening a past statement shows the stored PDF.
- Corrections (a back-dated journal, a change of owner, new bank details) appear on the **next** statement and never rewrite an issued one.
- The snapshot lets a statement be re-rendered only if a layout defect must be corrected. That re-render is itself recorded.

**Replaces:** re-rendering past periods from the current ledger, holder and trust account (audit F-44).

**Consequences:**
- **Backend:** needs document storage and an "issued document" record linked to the account, the period and the Sent message.
- **Pages:** the statement page shows "Issued on …" and the stored version; a draft or preview is clearly marked as such.

## D8 — PDF generation with headless Chrome

**Decision:**
- PDFs are produced by headless Chrome driven from .NET (PuppeteerSharp or Playwright), rendering **the same HTML templates** the app shows.
- It starts inside the backend and moves to its own rendering service when volume requires.
- It follows `docs/document-pdf-rendering-standard.md`:
  - A4 from the page CSS;
  - backgrounds printed;
  - no browser headers or footers;
  - the approved fonts installed in the rendering environment.

**Replaces:** browser print as the only way to get a PDF (audit F-43).

**Consequences:**
- **Regression set:** a statement with 30 rows; large amounts; long minutes; a letter of demand. Each in Standard, Professional and custom templates.
- **Unchanged:** jsPDF and html2canvas stay out.

**Open:** whether PDFs must be tagged for accessibility (later decision).

## D9 — Statement delivery

**Decision:**
- Statements are delivered as a **secure link** that opens the stored PDF in the resident portal.
- An agency can choose **attachment** instead, per agency.
- Either way:
  - the email is recorded in Communications › Sent;
  - delivery, and for links whether it was opened, is tracked.

**Replaces:** "Email statement" and "Re-send statement" buttons that only show a message (audit F-15).

**Consequences:**
- **Links:** expire and require sign-in.
- **Owners without a sign-in:** get an invitation with the first statement (D3).
- **Settings:** an agency setting in Settings › Billing ("Send statements as: link / attachment").
- **POPIA:** the link option keeps financial data out of inboxes.

## D10 — Statement numbering

**Decision:**
- Statements aren't numbered: the account number plus the period (e.g. KC-042, October 2026) identifies a statement uniquely.
- Gapless sequential numbering is used only for documents where the law requires it, such as tax invoices if agencies issue them through Humo PM.

**Replaces:** a simulated statement number on custom templates.

**Consequences:**
- **Custom templates:** they show the account and period reference instead of a number.
- **Future document types:** invoices and receipts get numbering when those types are built.

---

## D11 — Account Managers and subscription changes

Approved on 12 October 2026 by Terry Mosoma (product owner). Raised by doc 21 §9.

**Decision:**
- Humo Account Managers keep `Platform.Subscriptions.Manage`: they change packages, add-ons and feature overrides for **the customers they look after**, **without a separate approval**.
- **Every change is audited:**
  - who, which customer, what changed, when, and **the reason**;
  - refused attempts too (for example, another Account Manager's customer).
- The reason is required by the API, not only by the screen.
- Step-up (a fresh passkey) still applies, as for every subscription change.

**Replaces:** an open question. The account-approval brief said not to grant "commercial override permissions" automatically. This keeps the existing grant (doc 04) and makes the audit the control.

**Consequences:**
- **Backend:**
  - enforce `Platform.Subscriptions.Manage`, the own-customers scope, the reason and step-up server-side;
  - write each change to the append-only audit log.
- **Frontend (done 12 Oct 2026):** the mock API refuses a change without a reason (at least 8 characters, as the screen asks). Tests: `subscription-changes.spec.ts`.
- **System Administrators** review subscription changes in the platform audit log (*Subscription* events).

**Open:** the "own customers only" rule is checked by role name in the mock (`role === 'humo-account-manager'`). Per D4 it should become a permission or scope check (audit F-38, remediation P1-4).

---

## Still open (needs domain expertise before slice 2)

- **Levies and participation quotas:** is the monthly levy derived from the quota and the approved budget, or entered? (Audit F-14.) Also: interest rules, special levies, VAT.
- **The trust-accounting boundary:** what Humo PM is the system of record for, versus the agency's accounting package, under property-practitioner and sectional-title rules.
- **Data migration:** opening balances and history from the previous system.
