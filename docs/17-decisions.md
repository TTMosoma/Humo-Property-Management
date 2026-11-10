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
| D18 | Limit warnings: agency administrators are emailed at 80% and when a limit is reached; other staff see them in the app | Commercial slice |
| D19 | Basic invoicing on Essentials: owner invoices posted to the unit's account; manual statements stay on Essentials, bulk runs on Professional | Commercial slice |
| D20 | Storage limits: every uploaded file counts (1 GB = 1024³ bytes); the API refuses an upload past the limit before storing it; warnings at 80% as for units and people | Commercial slice |
| D21 | Advanced finance add-on for Essentials at R400 a month (proposed): levies, billing runs, payment allocation, debtors and credit control. Price to be confirmed | Commercial slice |
| D22 | Confirms D21: the Advanced finance add-on is R400 a month, with levies included | Commercial slice |
| D23 | Custom document templates are Enterprise only: the separate add-on is withdrawn; Enterprise includes one custom template (refines D12) | Documents, commercial |
| D24 | Approving with one authoriser: a trustee on Humo approves; with none on Humo, the agency approves alone under the trustees’ written permission, with a passkey, after a 24-hour cooling-off | Approvals |
| D25 | Owners pay levies online through each scheme’s own Payfast account, paid out to its trust account; the scheme pays Payfast’s fee | Finance, owner portal |
| D26 | Confirming without a passkey to hand (e.g. a public computer): your phone’s passkey by QR code first; a code by SMS to your own confirmed mobile as a fallback, for approvals only | Identity, approvals |
| D29 | Packages: the trustee register on every plan; scheme rules in Professional; meetings and AGMs stay Enterprise (the add-on is renamed “Meetings & AGMs”); advanced permissions dropped | Governance, commercial |
| D30 | Adding a passkey: once you have one, adding another needs it, with no exception for an email-link sign-in; you’re told every time; you choose where it lives | Identity, security |
| D31 | Amending or repealing a rule with Meetings & AGMs: a resolution that isn’t in the register can be typed from the minutes (changes D29 point 5) | Governance |
| D32 | What Finance can read: financial work and records, plus resolutions and a job opened from its invoice; no breaches, meetings, boards or compliance. A person doing both jobs holds both roles | Identity, finance, governance |
| D33 | Someone with no property left at an agency keeps a sign-in and sees who to contact, plus their own past statements, read-only (a *Former resident* role). Individuals can't add units | Identity, owner portal |
| D34 | One email address per person: a sign-in moves only when the new address confirms it, the old one is told, and the audit log records what it changed from and to | Identity, security |
| D35 | When a unit is sold: each month's statement belongs to whoever owned it that month; the buyer sees the account from their start date; the seller keeps every month they owned; nothing changes until the transfer date | Finance, owner portal |
| D36 | A unit always has an owner: ending the only owner is refused (record the sale by adding the buyer), and gaps already on record are flagged for staff to correct | Portfolio |
| D37 | Maintenance photos are uploaded and stored, and count against the agency's storage like any uploaded file; documents Humo PM generates (statements, letters) don't count | Maintenance, commercial |

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

## D18 — Limit warnings: email and in-app (22 October 2026)

**Decided by:** Terry Mosoma (product owner).

**Refines:** D16 and D17. Where they differ, this decision stands.

**Decision:**
- **Who is emailed:** the agency's administrators, at 80% of a limit and again when the limit is reached. Once per limit and level: the warning isn't repeated while the agency stays at that level.
- **Who sees it in the app:** every staff member with a role in the agency's staff app (portfolio managers, finance and operations staff, as well as administrators). The app means the agency's staff app, the bell in the top bar. The owner and resident portal doesn't show limit warnings.
- **Not emailed:** other staff. They see the warning in the app only.
- **Who acted doesn't matter:** an administrator who adds the unit or invites the person still gets the warning. It isn't a notice about their own action.
- **What it says:** which limit, how many of how many, and what the next package includes. It links to Settings › Plan & features.

**Consequences:**
- The warning is raised when units are added or people are invited.

---

## D19 — Basic invoicing and manual statements on Essentials (22 October 2026)

**Decided by:** Terry Mosoma (product owner).

**Decision:**
- **Basic invoicing** is part of Essentials (the `invoicing-basic` feature). An agency issues an invoice to an owner for a unit. Issuing it charges the unit's levy account, so the owner's statement shows it. A payment recorded by hand credits the account. Invoices are numbered per agency, INV-0001 onwards, and emailed to the owner on record on request.
- **Basic invoicing doesn't cover** automated billing runs, payment allocation from bank receipts, or credit control. Those stay on Professional.
- **Manual statements** stay on Essentials: an agency sends one owner a statement at a time. Bulk statement runs (after a billing run) stay on Professional.
- **Ledger:** an invoice is posted as an *adjustment* line on the account, with the invoice number in its description. A payment is a *payment* line with the reference (the invoice number unless one is given).

**Consequences:**
- The invoice number's sequence isn't gapless for tax purposes (Humo's own invoices are; agency invoices to owners aren't tax invoices, as D15 says for Humo).

---

## D20 — Storage limits: measured and refused by the API (22 October 2026)

**Decided by:** Terry Mosoma (product owner). The allowances are D16's (5, 25 and 150 GB); this entry sets how storage is measured and enforced.

**Decision:**
- **Storage is the total size of every file uploaded for the agency**: documents, library files and any other upload. **1 GB is 1024³ bytes.**
- **The API refuses an upload that would take the agency past its limit**, before the file is saved. A file that brings the agency to exactly its limit is accepted; one byte more is refused, with the package's allowance and the agency's current use in the message.
- **Warnings** work as they do for units and people (D16, D18): the administrator is emailed and staff see it in the app at 80% and when the limit is reached. Reaching 80% of storage also offers the Professional trial (D17).
- **A package with no storage figure** (negotiated) has no limit and no warning.
- **Nothing is charged, and no package is upgraded, automatically** (doc 23 §5).

**Consequences:**
- **Not counted yet:** files Humo generates (statements, letters and packs), backups and logs. Generated files join the count when the API stores them (R-13).
- **Archiving a library document keeps its file**, so it keeps its storage. A way to free storage (deleting files) isn't built.
- **The storage pack and temporary exception** in doc 23 §5 aren't built; an agency at its limit can't upload until its package changes.

---

## D21 — Advanced finance add-on for Essentials (proposed, 22 October 2026)

**Status:** proposed. The price is the product owner's to confirm or change; until then the catalogue shows it as *proposed*.

**Decision:**
- **Advanced finance** is an add-on that an Essentials agency can buy without moving to Professional. It switches on levy management (schedules, special levies and quotas), billing runs, payment allocation from bank receipts, debtors (age analysis and arrears) and credit control.
- **Price: R400 a month, proposed.** Essentials is R600 and Professional R2 400, a gap of R1 800. The add-on is about a fifth of that gap, so an agency that only needs the finance tools has a reason to stay on Essentials. It's priced above the WhatsApp add-on (R100) and below the SMS bundle (R500).
- **Stays on Professional:** supplier payments (payables), budgets and financial reporting.

**Consequences:**
- Manual statements and invoicing stay on Essentials (D19). The add-on doesn't change them.
- No new feature keys are needed: the add-on uses features that already exist in `contracts/entitlements.json`.
- The add-on is catalogue data (`demo-data/commercial/catalogue.json`, `advanced-finance`), so changing the price or features needs no code change.
- Levies moved from Professional to the add-on at the product owner's request, while D21 was still proposed. The price and scope are both still open to change.

---

## D22 — Advanced finance add-on confirmed (22 October 2026)

**Status:** approved by the product owner (Terry Mosoma). Supersedes D21's "proposed" status.

**Decision:**
- The **Advanced finance** add-on is **R400 a month**.
- Its scope stays as D21 set it: levy management, billing runs, payment allocation from bank receipts, debtors and credit control. Levies belong in the add-on.
- Supplier payments (payables), budgets and financial reporting stay on Professional.

**Consequences:**
- The catalogue seed shows the price as approved (`demo-data/commercial/catalogue.json`, `advanced-finance`).
- A database seeded before this change keeps the add-on's price as *proposed* until someone marks it approved in Platform › Pricing & add-ons. The catalogue keeps the history of who approved it and when.

---

## D23 — Custom document templates: Enterprise only (25 October 2026)

**Status:** approved by the product owner (Terry Mosoma). Refines D12; D12's way of building and approving templates stands.

**Decision:**
- Custom document templates are **only for Humo Enterprise**. The **"Custom Document Templates" add-on is withdrawn**: it sold the same feature (`document-templates-custom`) that Enterprise already includes, so Essentials and Professional agencies could have bought it outside Enterprise.
- **Enterprise includes one custom template**, designed and built by Humo from the agency's brief (D12). More templates, or redesigning one, are quoted per engagement.
- Later versions add ready-made template choices by package (docs/28): 2 for Professional, 4 for Enterprise, plus Enterprise's custom one.

**Consequences:**
- The add-on is gone from the starting catalogue. At start-up, a stored catalogue drops it too, unless an agreement ever included it (then it stays, retired, so history keeps its name).
- An agency on Essentials or Professional that wants its own design moves to Enterprise.
- D12's open question on pricing is answered for the first template (included); further engagements are quoted.

---

## D24 — Approving with one authoriser (25 October 2026)

**Status:** approved by the product owner (Terry Mosoma).

**The problem:** some approvals can't be approved by the person who prepared them (segregation of duties: a billing run today, supplier payments with slice 3b). An agency with one authoriser was stuck.

**Decision:**
1. **A trustee first.** When the preparer is the agency's only member of staff who could approve it, the scheme's trustees with a Humo sign-in can approve it in My work.
2. **Approving alone, only with no trustee on Humo.** The agency can't make trustees join Humo, and many boards have trustees who never will. So, where the scheme has no trustee on Humo:
   - **The trustees' written permission**, once per scheme: a signed resolution, letter or email, uploaded as a PDF in Settings › Agency. It lasts up to 12 months, or until withdrawn. Adding it needs a passkey.
   - **A passkey for every approval** made alone.
   - **A 24-hour cooling-off.** The approval takes effect only after it. Until then any approver can stop it.
   - **Notifications when it takes effect:** the approver, in the app, and by email and SMS as they chose for their work (WhatsApp once it's on Humo); and the scheme's trustees on record, by email (or SMS where they prefer it or have no email), with or without a Humo sign-in.
   - **Flagged in the audit log**, both when approved alone and when it takes effect.
3. **No mode to switch.** Humo doesn't switch it on. It applies only while the conditions hold: once a second authoriser joins (another approver at the agency, or a trustee on Humo), approving alone stops applying.

**Consequences:**
- API: `POST /work-items/{id}/decision` takes `alone`; `POST /work-items/{id}/cancel-hold`; `/trustee-permissions` (list, add with the PDF, withdraw). Approvals in their cooling-off have the status `cooling-off`; the minute loop releases them.
- My work shows who can approve instead, "Verify and approve alone", and the cooling-off with "Stop it".
- Supplier payments (slice 3b) use the same rules when they arrive.

---

## D25 — Owners pay levies online, into the scheme’s own Payfast account (28 October 2026)

**Status:** approved by the product owner (Terry Mosoma).

**The problem:** owners could only pay by EFT. Humo’s own Payfast account (D15) takes agencies’ payments for Humo invoices. It can’t take levies: levies are trust money and must reach the scheme’s trust account without passing through Humo.

**Decision:**
1. **One Payfast account per scheme.** In Settings › Agency › Trust accounts, the agency links the scheme’s own Payfast merchant (ID, key and salt passphrase), set at Payfast to pay out to that scheme’s trust account. Linking or turning it off needs a passkey, like the trust account itself. The passphrase is stored encrypted and never shown again.
2. **The owner pays the balance** from My account (*Pay with Payfast*: card, Instant EFT and Payfast’s other methods). Only the account holder can start it.
3. **Only Payfast’s notification counts**, checked with that scheme’s passphrase, against that merchant, for the right amount. It adds an allocated receipt (source *payfast*) and the payment line. Repeats change nothing.
4. **The scheme pays Payfast’s fee.** The owner is credited the full amount; the fee is a bank charge on the scheme’s books.

**Consequences:**
- API: `PUT /settings/trust-accounts/{schemeId}/payfast`, `POST …/payfast/remove`, `GET /accounts/{id}/payment-options`, `POST /accounts/{id}/card-checkout`, and the notification `POST /payments/notifications/payfast/levies`.
- My account shows the scheme’s real trust account and due date (they were placeholders before).
- **Bank reconciliation:** Payfast’s payout reaches the trust account as one deposit, net of fees, for payments already credited. When the bank statement is imported, finance moves that line to suspense with a note, not onto an account. Matching payouts automatically is future work.

---

## D26 — Confirming it’s you without your passkey to hand (28 October 2026)

**Status:** approved by the product owner (Terry Mosoma).

**The problem:** someone has to confirm an urgent approval from a public or borrowed computer. It has no passkey of theirs, and they have no trusted device with them.

**Decision:**
1. **Your phone first.** A passkey on your phone confirms on any computer: choose *Use passkey*, then *Use a phone or tablet*, and scan the QR code. Or open Humo PM on the phone and approve in My work. The confirmation dialog says so, and My profile suggests adding a passkey on your phone.
2. **An SMS code as the fallback, for approvals only.** A 6-digit code by SMS to the person’s own confirmed mobile stands in for the passkey when approving in My work. It never covers bank details, trust accounts, Payfast, users and access, or security settings: those always need a passkey. It never applies while impersonating, and not when approving alone under D24.
3. **The mobile is the person’s own**, added in My profile and confirmed by a code to it. Once they have a passkey, adding, changing or removing it needs that passkey, so someone who gets into their email can’t add their own number.
4. **Every use is visible.** It is flagged in the audit log (“FLAGGED: confirmed it’s them with an SMS code”), and the approval’s audit entry records *sms* as the method. The person is told by email and in the app, and the agency’s administrators in the app and by email.
5. **Limits:** codes last 10 minutes with 5 tries, at most one a minute and 5 a day. The confirmation lasts 5 minutes, like a passkey’s. Codes count in the agency’s SMS.

**Consequences:**
- API: `GET /me/mobile`, `POST /me/mobile/code`, `/me/mobile/verify`, `/me/mobile/remove`, `POST /me/step-up/sms`, `/me/step-up/sms/verify`. The SMS confirmation is a separate session claim, so nothing that checks the passkey mistakes it for one. Commands accept it only with `SmsStepUpAllowed`.
- Supplier payments (slice 3b) decide when they arrive whether releasing a payment may use it. The default is no.

---

## D27 — Paying suppliers: two people, verified accounts (28 October 2026)

**Status:** approved by the product owner (Terry Mosoma).

**The problem:** paying suppliers is where trust money is most often stolen. One person who can change a supplier's bank account and also pay it can redirect a payment to themselves. Humo PM also can't move money out of a trust account: the agency pays at its bank.

**Decision:**
1. **Bank details are entered once and verified by someone else.** They're entered from the supplier's bank confirmation letter, with a passkey. Payments to the supplier are then held until another approver (Agency Administrator or Finance) verifies them in My work, after calling the supplier back on the number already on file. Verifying always needs a passkey, never an SMS code (D26). With one approver at the agency, the D24 rules apply: a trustee on Humo verifies, or the agency verifies alone under the trustees' permission.
2. **Maker and checker.** Whoever prepares a payment batch doesn't approve it and doesn't release it. Approval is in My work, by another approver (D24 applies as for any approval). Release needs a fresh passkey (never an SMS code). The one exception: when nobody else at the agency can release, the preparer may, because the approval was the second person.
3. **A batch pays the accounts it was made with.** It holds each supplier's verified account. If an account changes after that, release is refused; the batch is cancelled and prepared again.
4. **Releasing gives a payment file** (CSV: beneficiary, bank, branch code, account number, account type, amount, references) to import into the trust account's internet banking. It marks the invoices and their jobs paid. One generic layout to start; layouts for particular banks come later.
5. **Each supplier is emailed a remittance advice** when their payment is released: the invoices, the amount, the date, the masked account and the reference.
6. **Narrowing what Finance can read** (docs/28 §2) is left for a separate decision.

**Consequences:**
- API: `POST /suppliers/{id}/bank-details` takes the account and opens a `bank-details-verification` approval; `GET /payables/invoices`, `GET /payables/batches`, `POST /payables/batches`, `POST /payables/batches/{id}/release` (returns the file), `POST …/payment-file` (again, audited) and `POST …/cancel`.
- My work shows *Verify bank details* approvals; Finance › Payables shows open batches and the last ten closed ones.
- Humo PM doesn't yet keep the scheme's cashbook: the payment to the supplier isn't posted to a ledger until it does.

---

## D28 — Budgets on the live system before meetings are (30 October 2026)

**Status:** approved by the product owner (Terry Mosoma).

**The problem:** owners approve a scheme's budget at the AGM, and in the prototype the passed resolution approves it. Meetings and resolutions aren't on the API yet (the Governance slice). Budgets also need each scheme's financial year, and agencies moving onto the live system already have this year's budget, approved before they arrived.

**Decision:**
1. **The owners' approval is recorded by hand** until meetings are on the API: the date of the AGM and the resolution's reference, from the signed minutes. It needs a fresh passkey, it's in the security log, and the figures are fixed after it. When Governance lands, *Put it to the AGM* works on the live system as in the prototype, and recording by hand stays for budgets approved outside Humo PM.
2. **The financial year end is a scheme setting.** It's asked for the first time a budget is made for the scheme (February by default), and changed in Settings › Levies & billing. Compliance will use the same setting.
3. **This year's budget can be captured part-way**, for a scheme new to Humo PM: its lines, then the spending before Humo PM up to a date (and the levies billed), then the owners' approval. Actuals count Humo PM's own records from the day after, so they're right from day one.

**Consequences:**
- API: `GET /budgets`, `GET /budgets/{id}`, `POST /budgets` (this year's or next year's), `POST /budgets/{id}/actions` (set or remove a line; `record-approval`; `set-opening`; `propose` is refused until meetings are on the API); `GET /settings/compliance-profiles`, `PUT /settings/compliance-profiles/{schemeId}`.
- Approval cards for quotes and invoices show the job's budget line with what's been spent and committed.
- Levies actual is what the ledger billed in the year (plus the levies before Humo PM for a captured year), not an estimate from the levy roll.

## D29 — What each package adds (2 November 2026)

**Status:** approved by the product owner (Terry Mosoma).

**The problem:** the trustee register was part of Governance, which is Enterprise only. But every plan relies on it. Trustee access comes from the board register (D2). When an agency approves alone, the trustees on record are told (D24), and the smaller agencies that approve alone are on Essentials or Professional. They had no way to record trustees, so nobody could be told.

Reviewing what each package adds over the one below, Enterprise's own features were thin: several aren't built, and "advanced permissions" (custom roles) contradicts D4.

**Decision:**
1. **Trustee management is in every plan** (Essentials, so Professional and Enterprise too): Governance › Trustee boards, with adding and ending terms, portfolios, the board's minimum and inviting trustees to Humo PM.
2. **Scheme rules and the breach log are in Professional** (and Enterprise): day-to-day work for the agency, not board work.
3. **Meetings stay Enterprise:** trustee meetings, AGMs and SGMs, resolutions and actions. The Governance add-on that sells them to Professional agencies is renamed **"Meetings & AGMs"** (its id stays `governance`, so agreements and invoices are unaffected; invoices already issued keep the name they had).
4. **Advanced permissions is dropped.** Roles are fixed (D4); there are no custom roles to sell.
5. **Without Meetings & AGMs, a resolution is typed** from the signed minutes (e.g. "AGM 12 March 2026, resolution 4"), with the date it was passed, when electing a trustee or adopting, amending or repealing a rule. With it, the resolution is chosen from the register, as before.

**Consequences:**
- `contracts/entitlements.json`: `trustee-management` moves to Essentials; a new `scheme-rules` feature is in Professional; `permissions-advanced` is removed.
- API: `POST /boards/{schemeId}/actions` needs `trustee-management`, not `governance`. Scheme rules on the API need `scheme-rules` (added 2 November 2026).
- At start-up a stored catalogue whose add-on is still called "Governance" gets the new name, description and features. A name Humo has given it since stands.
- The Governance menu shows *Trustee boards* on every plan and *Scheme rules* from Professional; `/governance` opens Trustee boards.

---

## D30 — Adding a passkey (2 November 2026)

A passkey can sign in and confirm payments and bank details, so adding one is a way to take over an account.

**Decision:**
1. **Once someone has a passkey, adding another needs it**, on this device or by phone QR code. The API enforces this on `POST /me/passkeys/options` and `POST /me/passkeys` (`step-up-required`). There's no exception after an email-link sign-in: that proves only control of an inbox, and D26 already treats an inbox as not enough.
2. **A first passkey needs no proof**, as there's nothing to prove it with.
3. **Lost every passkey:** Humo Support removes them after checking it's the person (`Platform.Users.ResetPasskeys`, with a reason and an audit entry). They then add a new first passkey. This replaces self-service recovery by email link.
4. **The person is told:** every passkey added or removed sends a notice and an email saying what to do if it wasn't them. Attempts without the proof are in the audit log.
5. **They choose where it lives:** this device, phone or tablet, security key, or password manager or browser. This is a preference: the browser and device make the final offer, and a password manager add-on can step in first. The choice names the passkey in their list and email.
6. **Failures stay on screen** until dismissed, saying what happened and what to do. A toast alone isn't enough.
7. **No passkey is offered at sign-in on a shared computer.** Answering "No, it's shared", or signing in on a browser already answered that way, goes straight in. A passkey can still be added in Settings › Security, e.g. on a phone by QR code.

**Consequences:** while impersonating, staff can't add a passkey (`impersonating`).

---

## D31 — A rule's resolution that isn't in the register (3 November 2026)

An agency with Meetings & AGMs could only cite a resolution from the register. A resolution passed before the agency joined Humo PM, or at a meeting not recorded here, isn't in it, so the rule couldn't be amended or repealed without recording a meeting after the fact.

**Decision:** this changes D29 point 5 for rules.
1. **Amending or repealing a rule:** the Resolution list also offers *Not in the register: type it from the minutes*, with the date it was passed. The rule's history shows the reference as typed, and the audit log records who entered it.
2. **Nothing is chosen for them:** the list starts on *Choose the resolution*.
3. **Unchanged:** a resolution must still be cited, and a typed one needs a date that isn't in the future. Electing a trustee and adding a rule work as D29 says.

**Consequences:** Humo PM doesn't check a typed resolution against any record, so it relies on the signed minutes the agency keeps. The API already accepted a typed resolution on every package, so only the form changes.

---

## D32 — What Finance can read (5 November 2026)

**Status:** approved by the product owner (Terry Mosoma). This settles D27 point 6 and docs/28 §2.

An accountant was shown the same records as a portfolio manager, including who broke which rule. That's distracting, and it's more than the job needs: a breach is a record of someone's conduct, and POPIA expects access to personal information to be limited to what the job needs.

**Decision:**
1. **Queue:** Finance's tasks and badges hold financial work only. The API sends each role only its own work items, and hides the rest from a colleague's staff page too.
2. **Rule breaches:** no access for Finance, with no exception: not the log, the rules, the tasks or the warning letters. If fines ever go onto levy accounts, Finance will see the charge and its reference, not the breach history.
3. **Breach tasks** have their own type. They go to the scheme's portfolio manager, then a cover who can enforce the rules, then an administrator, and can't be assigned to anyone else.
4. **Resolutions:** read-only for Finance (`Resolutions.View`), because special levies, budgets and legal action rest on them. Meetings and trustee boards stay out (`Governance.View`).
5. **Maintenance:** Finance opens a job from its invoice, read-only (`Maintenance.View`). It can't browse or search the jobs (`Maintenance.Browse`) or log a request (`Maintenance.Log`).
6. **Compliance:** none for now (`Compliance.View`). Compliance isn't on the API yet; when it is, Finance should get the financial items only (audited statements, the CSOS return).
7. **Doing both jobs:** someone at a small agency who does the books and runs schemes holds both roles and switches between them.
8. **No view-only role.** "See everything, do nothing" is what this decision removes. The one real case is an external auditor, who would need time-limited read access to finance; build that when a customer asks.

**Consequences:**
- Roles are still fixed (D4). `contracts/role-permissions.json` gains `Maintenance.Browse` and `Resolutions.View`.
- Finance can still prepare a budget, but putting it to the AGM falls to someone who runs meetings.
- Finance keeps Inbox, Communications, Documents, Units and People, which it needs to answer owners. Operations keeps its current reads; reviewing them is a separate decision.
- A migration relabels existing breach tasks. One already assigned to a Finance user disappears from their queue and stays visible to administrators.

---

## D33 — Someone with no property left (5 November 2026)

**Status:** approved by the product owner (Terry Mosoma).

When someone's last role at an agency ended, Humo PM treated them as signed out, so they came back to the sign-in page with no explanation.

**Decision:**
1. **They stay signed in** and see: "You don't have any property registered under your name at the moment", with the agency's contact details in case it's a mistake.
2. **They keep what's theirs, read-only:** the statements addressed to them, what they used to hold, and their own profile and security. Nothing of the scheme: no notices, jobs, documents or messages.
3. **Individuals can't add units.** Humo PM stays a system for managing agencies.
4. **This is a role, *Former resident* (`past-resident`).** It adds a fixed role (D4). Nobody grants it: it follows when someone with an owner, tenant or trustee role has no active role left at that agency, including when an ownership ends on a future date.
5. **Only for people who had a resident role.** Anyone else with no role left, such as a staff member, is told at sign-in that they don't have access at the moment.
6. **An administrator can end it** in Users & access, and then it stays ended. If they become an owner again, they land on that role, and can still switch to see the past.
7. **It doesn't use the agency's allowance** of people with a sign-in.
8. **No landlord app link for now.** That app doesn't exist yet; ask before adding one.

**Consequences:**
- API: `GET /me/past-resident` and `GET /me/past-resident/statements/{id}/pdf`, with the new `Statements.ViewPast` permission.
- A joint owner who wasn't the account holder has no statements to read, because none were addressed to them.
- **Retention isn't decided:** there's no time limit on this access. It should follow the POPIA retention decision still blank in docs/26 §3.
- An owner who sells one unit and keeps another isn't a former resident, so they don't see the sold unit's statements. That's a possible follow-up.
- The simulation doesn't move anyone to this role when a role ends.

---

## D34 — Changing someone's email (5 November 2026)

**Status:** approved by the product owner (Terry Mosoma).

Each person had two addresses that didn't know about each other: a contact email in People (statements, letters, messages) and a sign-in email in Users & access (sign-in links, invitations, work notices). Editing one left the other behind, so a person's new address got nothing. Whoever controls a sign-in's email can sign in with an email link, so simply linking them would let one typo, or one dishonest edit, hand over someone's account. The audit log said only that details were updated, not what changed.

**Decision:**
1. **Changing an email is allowed.** There's one address per person.
2. **No sign-in:** it takes effect straight away.
3. **Has a sign-in:** the new address gets a link to confirm, for 7 days, and the old address is told. Nothing changes until the link is used, statements included. Then both records change together, other sessions end, sign-in links still out stop working, and passkeys stay. The old address is told again.
4. **Staff:** the same from Users & access, and the administrator also confirms with a passkey.
5. **Only the new address has to confirm**, so someone who lost the old mailbox can still move.
6. **An address another sign-in uses is refused**, when asked and again when confirmed. A newer request replaces the old link, and staff can cancel one.
7. **The audit log says what changed:** the old and new email and mobile, which other details changed, who asked, and when it was confirmed or cancelled.
8. **Records that already disagree** are listed for administrators in Users & access, who choose: keep the sign-in address (it's proven, so it applies at once), or ask the contact address to confirm (with a passkey).

**Consequences:**
- API: `POST /auth/email-change/confirm`, `GET /people/{id}/email-change`, `POST /email-changes/{id}/cancel`, `GET /access/email-review`, `POST /access/identities/{id}/email-mismatch`.
- An unresponsive owner stays on the old address. The record shows the change is waiting.
- A sign-in that spans several agencies moves everywhere, but only the contact address on its linked record changes.
- Humo's own staff aren't covered: their addresses are on Humo's domain and managed by a System Administrator. Those edits are audited with the old and new address.
- Owners changing their own email in My profile is left for later; it would use the same confirmation.
- The simulation still changes an email straight away and sends nothing.
- Rows already in the audit log can't be improved; they stay as written.

---

## D35 — When a unit changes hands (6 November 2026)

**Status:** approved by the product owner (Terry Mosoma).

A unit's levy account stays with the unit when it's sold, so its history goes with it. Joseph Jackson, who buys Die Eike unit 3 on 20 November, could already see Marike du Toit's months on it, and a statement issued today for September was addressed to him. Marike, the seller, saw none of her statements. A sale dated in the future also took effect at once.

**Decision:**
1. **A statement belongs to whoever owned the unit that month:** the owner on its last day (the account holder first, if it's owned jointly), or the last owner before a gap between owners. Sending one for a seller's month goes to the seller.
2. **The buyer sees the account from their start date:** "Balance when you took over", then their own months. They can't open a statement for a month before that. Before a transfer is registered the scheme normally confirms the levies are paid, so that balance is usually nil; if not, the agency resolves it with the seller.
3. **The seller sees every month they owned, read-only,** on their *Former resident* page. A month whose statement was never sent to them is issued to them when they open it, and kept like any issued statement (D7).
4. **Nothing changes until the transfer date.** The buyer's access and the account hand-over both wait for it, and between owners the account stays with the seller.
5. **A statement addressed to someone who didn't own the unit that month** is kept on record as replaced (a migration does this for ones already issued), so the right owner's can be issued.

**Consequences:**
- An owner, tenant or trustee whose start date is still to come has no access until that day. Before, only the end date was checked.
- A month split by a sale belongs to whoever owned it on its last day. Lines from earlier in the buyer's first month still show to the buyer.
- An owner who sells one unit and keeps another still doesn't see the sold unit's statements (left from D33).

---

## D36 — A unit always has an owner (7 November 2026)

**Status:** approved by the product owner (Terry Mosoma).

A sectional title unit always has a registered owner, and ownership passes from seller to buyer on the day the transfer is registered, so there is never a real day with no owner. Die Eike unit 3 had one on record anyway: Joseph Jackson was added from 20 November, and Marike du Toit's ownership was then ended on 4 October, leaving no owner from 5 October to 19 November.

**Decision:**
1. **Ending the only owner is refused** when it would leave the unit with nobody. The message says to record the sale by adding the buyer with *They replace the owner*, which ends the seller the day before. An owner who has died is replaced by their estate the same way. *Remove*, for an owner added by mistake, is unchanged.
2. **Correcting dates can't open a gap** either, but it can close one.
3. **Gaps already on record are flagged:** on the unit's page, and at the top of Portfolio › Units for every unit in view, for staff to correct the owners' dates.
4. **Until they're corrected,** D35 applies: the months and the account stay with the last owner.
5. **Correcting dates takes effect at once:** the account and portal access follow the new dates straight away, not at the next minute's check.
6. **Adding an owner after the last one's last day:** they start the day after it. If the transfer was registered later, the seller's last day is corrected first.
7. **The same person can't own a unit twice:** someone who already owns it from a later date is refused, with a pointer to correct that date instead.

**Consequences:**
- API: `GET /units/owner-gaps`. Ending an ownership (`POST /relationships/{id}/end`) and correcting its dates (`PUT /relationships/{id}`) refuse a change that leaves days with no owner.
- A unit that has never had an owner, such as a new unit, isn't flagged.
- The *Former resident* page (D33) now arises from a sale, never from ending an ownership with nobody after it.

---

## D37 — Maintenance photos, and what counts as storage (8 November 2026)

**Status:** approved by the product owner (Terry Mosoma).

Photos on a maintenance request were kept by name only on the live system, so they couldn't be seen or counted against the agency's storage.

**Decision:**
1. **Photos are uploaded and stored.** Staff add them to a job; a resident adds them to their own request. JPEG, PNG and WebP are accepted; HEIC is refused with a hint, because most browsers can't show it. Each photo is virus-scanned like any upload, and a job holds up to 20.
2. **Before and after:** a resident's photos are of the problem. Staff photos added once the work is done are of the finished work.
3. **They count against storage** like every uploaded file (D20), and are refused past the limit.
4. **Generated documents don't count:** statements, letters and other documents Humo PM issues. The agency can't delete them and must keep them, so counting them would penalise keeping records.
5. **Completing a job no longer adds a "Completed work" photo** that isn't there.

**Consequences:**
- API: `POST /jobs/{ref}/photos` (multipart) and `GET /jobs/{ref}/photos/{photoId}`.
- Photos recorded by name before this stay as named placeholders.
- Removing a photo added by mistake is left for later.

---

## D39 — Spending above the limit is the board's to approve (9 November 2026)

**Status:** approved by the product owner (Terry Mosoma). D38 is held for supplier emails and links.

**The problem:** a quote above the delegated limit is "sent to the trustees", but Agency Administrators and Portfolio Managers can approve it too, including the person who sent it. An invoice above its quote is the same. So the limit doesn't limit anything. One trustee's approval also passes where a board decision needs a majority, trustee-only resolutions stick when no trustee is on Humo, and the limit is the same R5 000 for every scheme.

**Decision:**
1. **Above the limit, only the board decides.** Agency staff recommend; they can't approve. This covers a quote above the limit, and an invoice above its approved quote where the invoice is above the limit.
2. **Each scheme has its own limit**, set in the scheme's settings with a passkey and recorded in the audit log. It starts at R5 000.
3. **A majority of the board.** More than half of the trustees on the board register (D2), whether or not they have a Humo sign-in. A trustee who approves on Humo counts as one.
4. **Trustees not on Humo: upload their signed approval.** For that one item, staff upload a PDF (a signed resolution, letter or email), choose from the board register who signed it, and give the date.
   - An upload can count with approvals made on Humo towards the majority.
   - It needs a passkey and is flagged in the audit log.
   - It can't approve a different item or amount from the one it was uploaded for.
5. **Every trustee on record is told at once**, by email, or SMS where they prefer it or have no email, with what was approved and who is said to have signed. Whoever is named can dispute a forged upload straight away.
6. **A rejection by a majority ends it.** The item goes back to the agency, with the reason.
7. **Emergencies.** On a job marked urgent, an Agency Administrator or Portfolio Manager can go ahead above the limit, to make the property safe, with a written reason and a passkey. It is flagged, every trustee is told at once, and the job shows "Board to confirm" until the board has approved it the usual way (points 3 to 5). The invoice can't be paid until then.
8. **Written resolutions** use the same majority and the same upload.
9. **D24 doesn't apply above the limit.** The trustees' 12-month written permission lets an agency with one approver approve its own routine items. It doesn't replace the board's approval of spending above the limit.

**Consequences:**
- The API enforces all of this; the screens follow it.
- Existing approvals still open when this goes live follow the new rule.
- How many must sign, and the emergency route, should be confirmed by a practising managing agent, because each scheme's mandate and rules may differ.
- Item 9 (correcting a quote) and item 20 (write-offs) build on this.

---

## D40 — Resolving an owner's dispute, and correcting an account (10 November 2026)

**Status:** approved by the product owner (Terry Mosoma). Every write-off goes to the board.

**The problem:** *Resolve dispute* writes a note and restarts collection; it moves no money. "Partly written off" posts nothing and links to nothing, so a dispute can be closed as written off while the debt stands, or the other way round. Separately, one person with billing rights can credit an account by up to R100 000 with a journal, with no second person, and nothing ties that credit to a reason anyone checked. Levy debt is the scheme's money, so the agency shouldn't be able to clear it alone.

**Decision:**
1. **Resolving a dispute means choosing what happened, and that does the accounting:**
   - **The charge stands:** nothing moves; collection resumes.
   - **The owner paid:** the payment is a receipt in the trust account. Choose an unallocated or suspense receipt and allocate it, or capture the payment as it appears on the bank statement. Never a journal. Cash is banked first, then recorded from the bank statement.
   - **Charged in error, or twice:** reverse the specific charge. Pick the line on the account; the credit is for that line's amount or less, linked to it, and a charge can't be reversed twice.
   - **Waived (written off):** some or all of what's owed, as the board agreed.
2. **Who approves:**
   - A **reversal** needs a second person: someone other than whoever prepared it, in Approvals. An agency with one approver follows D24.
   - A **write-off** needs the board, as D39: a majority of the board register, on Humo or by signed approval uploaded for that item. Any amount: it's the scheme's money being given up.
3. **Evidence and the record:** every outcome needs a reason; a proof of payment or the board's approval can be attached. The dispute links to the receipt, reversal or write-off, and the account's statement shows it as its own line ("Reversal of …", "Written off by the board …").
4. **A dispute closes only when its accounting is done.** Until the reversal or write-off is approved, it stays *Resolving*, and collection stays paused. Rejected, it goes back to *Disputed* with the reason.
5. **The case closes itself when nothing is overdue**, and its follow-up task with it.
6. **No back door:** a journal from the account page follows the same rules. A credit is a reversal (second person) or a write-off (the board); a charge (debit) needs a reason, as now. The R100 000 cap stays.

**Consequences:**
- Existing journals and resolved disputes stay as they are; this applies from when it goes live.
- What counts as a write-off the agency may make without the board (for example, small interest amounts under its mandate) is for a practising managing agent or auditor to confirm. Until then, every write-off goes to the board.
- Builds on D39 (the board's approval and upload) and D24 (one approver).

## Still open (needs domain expertise before slice 2)

- **Levies and participation quotas:** decided per scheme in **D13**. Still open: interest rules, special levies, VAT.
- **The trust-accounting boundary:** what Humo PM is the system of record for, versus the agency's accounting package, under property-practitioner and sectional-title rules.
- **Data migration:** opening balances and history from the previous system.
