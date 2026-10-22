# 17 — Product and architecture decisions (D1–D14)

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
| D12 | Custom document templates: a Humo-owned, paid Enterprise service built from the client's designs (hybrid: expanded design settings, plus bespoke layouts where needed) | Documents, Slice 2 |
| D13 | Each scheme chooses how levies are set: entered per unit (default) or derived from the approved budget and participation quotas | Slice 2, billing |
| D14 | Sign-in with ASP.NET Core Identity and passkeys inside Humo's API; hosted on a Webway VPS in South Africa; self-hosted email (supersedes D5's "not built in-house") | Slice 1 |
| D15 | Commercial terms: Payfast, no VAT, approved package prices, daily pro-rata, a second approver for discounts above 20%, a Humo Finance role | Commercial slice |
| D16 | Package limits by units, users and SMS; schemes unlimited; automatic Professional trial at 80% of an Essentials limit; existing customers keep their terms until renewal | Commercial slice |
| D17 | Refines D16: Professional includes 25 people with a sign-in; the Professional trial is offered at 80%, and the customer starts it; no existing customers to keep on old terms (not yet live) | Commercial slice |

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

**Superseded in part by D14 (18 Oct 2026):** sign-in uses ASP.NET Core Identity inside Humo's API. The selection criteria above still apply.

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
- **Built 18 Oct 2026 (frontend, step 1b):** quotes, supplier invoices, payment batches, billing runs and letters of demand. Minutes and written resolutions aren't covered until the voting question is settled.

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

## D12 — Custom document templates are a Humo-owned, paid Enterprise service

Approved on 12 October 2026 by Terry Mosoma (product owner).

**Decision:**
- **What the client gets:** their documents in **their own design**, built by Humo from the designs and brief they supply. A Humo layout in their colours isn't enough.
- **How Humo builds it (hybrid):**
  - **Expanded design settings** for most clients, configured by Humo staff without code. Today's colours, font, sections, title, footer and legal text, extended with structured options: header style, logo position, section order, column choices, extra text blocks.
  - **A bespoke layout** for Enterprise clients whose design needs it. Humo builds a layout for that client (for example `levy-statement/acacia`), shipped with the app and rendered by the same PDF renderer (D8).
- **Humo-owned:**
  - The Humo Account Manager collects the brief and designs, and Humo builds or configures the template.
  - **The client approves a proof**, and Humo publishes that version.
  - The client's administrator can see versions, preview them and choose the template as their default, but **can't edit or publish** it.
- **Paid:** custom design is a **paid service** for Enterprise customers, on top of the Enterprise entitlement (`document-templates-custom`).

**Replaces:** customer-edited custom templates. Before, the Agency Administrator published new versions from Settings, and "custom" meant only colours, font, sections and text on a Humo layout.

**Consequences:**
- **Done in the frontend (12 Oct 2026):**
  - Publishing moved from the customer's Settings to **Platform › Document templates** (*Publish version*, `Platform.Customers.Manage`).
  - Each version records **who at the client approved the proof and when** (`TemplateVersion.clientApproval`); the API requires it.
  - The agency's Settings show the template, its versions and approvals, read-only, with how to request a change.
  - Tests: `custom-templates.spec.ts`.
- **Still to build:**
  - **Expanded design settings:** new structured fields on `TemplateDesign`, never free-form markup or customer code (architecture doc §7).
  - **Bespoke layouts:** a process to add a client layout key, its Angular component and its renderer template, versioned with the app.
  - **A proof step in the product:** a draft version the client reviews and approves in Humo PM, instead of approval recorded by Humo staff.
  - **Billing the design service:** a priced service line or add-on per engagement. No billing processing exists yet.
- **Backend:** enforce Humo-only publishing and the recorded approval server-side; store the approval with the version; audit it.

**Open:**
- The price and packaging of the design service (one-off fee, per document type, or included in an Enterprise tier).
- Whether minor changes (contact details, legal text) still need a proof.

---

## D13 — How a scheme's levies are set

Approved on 12 October 2026 by Terry Mosoma (product owner). Scope: [22-billing-inputs-scope.md](22-billing-inputs-scope.md) §3.

**Decision:**
- **Each scheme chooses** how its levies are set:
  - **Entered per unit** (the default): each unit's monthly levy is entered and edited on the unit, as today.
  - **Derived from the approved budget:** monthly levy = the approved budget's annual *Levies* income × the unit's participation quota (normalised to 100% across the scheme) ÷ 12, to the cent.
- **Derived levies are proposed, never applied silently.** Someone with `Billing.Run` reviews the proposed levy roll (each unit's current and new levy) and applies it with a reason. It's audited.
- **New levies apply from the next billing run.** Applying is refused while a run is in progress, and the run's *Levy changed* exception still asks for each change to be confirmed.

**Replaces:** the open question "is the monthly levy derived from the quota and the approved budget, or entered?" (audit F-14). Both are supported, chosen per scheme.

**Consequences:**
- **Frontend:** behind the `levy-model` flag (doc 22); built 12 Oct 2026 (Levies & billing › How levies are set).
- **Backend:**
  - store the method per scheme, and the applied levy roll with its effective period, budget and approver;
  - billing reads the levy in force for the period.
- **Not in v1 (doc 22 §3):** catch-up levies, exclusive-use quotas, rounding policies, mid-year revisions.

**Open (needs a sectional-title expert):**
- whether quotas must be normalised or used as registered;
- the legal effective date of a new levy after the AGM;
- whether a rounding difference must be absorbed.

## D14 — Sign-in, hosting and email: self-hosted in South Africa

Approved on 18 October 2026 by Terry Mosoma (product owner). Options and reasons: [25-identity-and-hosting-options.md](25-identity-and-hosting-options.md).

**Decision:**
- **Sign-in:** ASP.NET Core Identity (.NET 10) inside Humo's API.
  - Passkeys first.
  - One-time email codes to join or recover.
  - No passwords.
  - It's an established framework, not home-made authentication, but it runs in our API rather than as a separate identity product. **This supersedes D5's "not built in-house".**
- **Hosting:** a dedicated Webway VPS in South Africa running Caddy, the API and PostgreSQL in Docker Compose.
- **Email:** an open-source mail server run by Humo (Stalwart recommended), sending from `notify.humo.co.za`, with a fallback relay configured but switched off.

**Why:**
- **Cost:** no per-user charges at any scale, and no licences.
- **POPIA:** every piece of personal data stays in South Africa.
- **Fit:** passkeys are built into .NET 10; the existing `/sign-in` page stays.

**Consequences:**
- **Humo carries the security and maintenance.** Everything to look after is in [26-operations-and-maintenance.md](26-operations-and-maintenance.md):
  - monthly .NET patching;
  - OS and container updates;
  - backups and restore tests;
  - email deliverability.
- **The passkey domain (relying-party ID) is chosen once and never changed.**
- **Session:** a secure, same-site cookie carrying the identity and the active assignment; step-up is a fresh passkey assertion recorded in the session.
- **One Humo sign-in for every product (D5 criterion 2):** the API is the sign-in authority. An OpenID Connect layer (e.g. OpenIddict) is added only if another product needs it.
- **Humo Mobile push approval** stays a later addition (D5).

**Sign-in domain (decided 18 Oct 2026):** `pm.humo.co.za`. It's the passkey relying-party ID and must never change.

**Open:**
- the VPS size and data-centre confirmation (doc 25 §2, *Ask Webway before buying*);
- the mail server's final choice after a trial.

---

## D15 — Commercial terms (19 October 2026)

**Decided by:** Terry Mosoma (product owner), answering doc 23 §8.

**Decision:**
- **Payment provider:** Payfast.
- **VAT:** Humo is not VAT registered, so invoices charge no VAT and aren't tax invoices (no gapless numbering, D10). Humo's legal name for invoices is still to be given.
- **Packages** (approved; annual = 11 months):

  | Package | Monthly | Annual | Schemes included | Storage |
  |---|---|---|---|---|
  | Essentials | R600 | R6 600 | 5 | 5 GB |
  | Professional | R2 400 | R26 400 | 25 | 25 GB |
  | Enterprise | R9 600 | R105 600 | 125 | 125 GB |

  - Extra schemes: **R150 per block of 10** (a part block counts).
  - **Annual renewal fee: R250**, every package.
- **Add-ons:** the proposed prices are approved (WhatsApp R100 a month with 500 messages; storage packs R150 / 10 GB, R600 / 50 GB, R1 000 / 100 GB).
- **Custom document templates (D12):** included in Enterprise; a paid add-on for Essentials and Professional (price to be set).
- **Mid-cycle changes:** daily pro-rata.
- **Discounts above 20%** of the recurring charges need a **second approver**, never the person who asked (`Platform.Discounts.Approve`).
- **Billing** (issuing invoices, verifying payments: `Platform.Billing.Manage`) sits with a new **Humo Finance** role, not the System Administrator. This adds a fixed role (D4).
- **Sole-administrator safeguard (doc 16):** the 24-hour cooling-off period is confirmed.
- **Passkey approval threshold (doc 03):** R50 000 by default, set by each agency's administrators.
- **Designated account manager:** Mashoto Moropane.
- **Levy-slice questions** (interest on arrears, special levies, VAT on levies, the trust-accounting boundary, migration): follow South African industry standards for sectional-title and HOA management.

**Replaces:** the open questions in doc 23 §8 and doc 04 §9 (all approved as described).

**Consequences:**
- The initial catalogue (`demo-data/commercial/catalogue.json`) carries these prices as *approved*; the commercial settings default to daily pro-rata.
- Pricing supports blocks of extra schemes (`extraSchemeBlock`).
- A discount above the threshold waits on the agreement (*Waiting for approval*) until Humo Finance or a System Administrator approves it.

**Open:** Humo's legal name and registration number on invoices; the custom-template add-on's price.

---

## D16 — Package limits: units, users and SMS; schemes unlimited (22 October 2026)

**Decided by:** Terry Mosoma (product owner).

**Supersedes:** the package limits in D15 (schemes included, extra-scheme blocks and included storage). D15's prices, annual terms, renewal fee and add-on prices stand.

**Decision:**
- **Prices (unchanged from D15):** Essentials R600 a month, Professional R2 400, Enterprise R9 600. Annual is 11 months. Renewal fee R250, every package.
- **Schemes:** unlimited on every package. The extra-scheme charge (R150 per block of 10) is removed.
- **Units under management** (the measure for limits):

  | Package | Units | Users | SMS a month | Storage |
  |---|---|---|---|---|
  | Essentials | 50 | 5 | 50 | 5 GB |
  | Professional | 250 | 50 | 250 | 25 GB |
  | Enterprise | 1 500 | 150 | 1 500 | 150 GB |

- **Warnings:** a warning at 80% of any limit, in the app and by email to the account administrator.
- **Reaching a limit:** adding a unit, a user or a message beyond the limit is refused with a plain message that says what the next package includes. Nothing that already exists is removed or locked.
- **Automatic Professional trial:** when an Essentials customer reaches 80% of a limit, they're offered a 30-day Professional trial automatically. It's offered once per customer, never charges anything, and ends by returning them to Essentials. It doesn't start during a billing run.
- **What a trial customer is told, before it starts and again when it ends:** everything they created stays, records and documents remain visible, and automated features stop (billing runs, payment allocation, credit control, bulk statements). They can upgrade again at any time.
- **Records during and after a trial:** anything created during the trial stays and remains readable after the trial. Automated features that create new work stop when the trial ends.
- **Existing customers** keep their current terms until renewal. The new limits apply from the renewal date.
- **Messages:** the included SMS allowance is a monthly allowance; extra messages are bought as SMS bundles (D15 add-ons).

**Consequences:**
- The initial catalogue (`demo-data/commercial/catalogue.json`) carries these limits as approved.
- The catalogue gains included units, users and monthly SMS; the scheme limits and extra-scheme blocks are no longer used.
- The app enforces unit and user limits when they're added, and warns at 80%.

**Open:** whether email counts against any allowance (none is set); the wording of the trial messages is to be approved before launch.

---

## D17 — Refinements to D16 (22 October 2026)

**Decided by:** Terry Mosoma (product owner).

**Refines:** D16. Where they differ, this decision stands.

**Decision:**
- **People with a sign-in:** Essentials 5, Professional **25**, Enterprise 150.
- **Professional trial:** the customer decides. At 80% of an Essentials limit, the agency's administrator is *prompted* to try Humo Professional free for 30 days, and starts it themselves. It's never started automatically. It can be used once per agency, charges nothing, and ends by itself, returning the agency to Essentials.
- **What the trial says:** the prompt and the end of the trial state that everything created stays and remains visible, and that automated features stop (billing runs, payment allocation, credit control, bulk statements).
- **Warnings:** the warning shows in the staff app (the agency's working console), not in the owner and resident portal. Warning emails to the agency's administrator are not part of this decision yet.
- **Existing customers:** none. The product isn't live, so there's nothing to keep on old terms. D16's requirement to keep existing customers on their current terms until renewal is withdrawn.

**Consequences:**
- The initial catalogue carries Professional at 25 people.
- The trial is an override on the agency's subscription that expires on its own.

---

## Still open (needs domain expertise before slice 2)

- **Levies and participation quotas:** decided per scheme in **D13**. Still open: interest rules, special levies, VAT.
- **The trust-accounting boundary:** what Humo PM is the system of record for, versus the agency's accounting package, under property-practitioner and sectional-title rules.
- **Data migration:** opening balances and history from the previous system.
