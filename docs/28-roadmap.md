# 28 · Roadmap

**Purpose:** what's next, in order, and what the product owner has asked for in later versions. Approved decisions stay in [docs/17](17-decisions.md); items here become decisions when they're scheduled.

**Last updated:** 13 November 2026.

## 1. Version 1: the live system as complete as the prototype

The prototype (`npm start`) runs every screen on simulated data. The live system (`npm run start:api`) runs only what's on Humo's API. Four data sources aren't on the API yet (Platform › Document templates joined it on 26 October 2026; timelines and notes, and payables (slice 3b, D27), on 28 October; Staff on 29 October; Budgets, and the financial year end from Compliance, on 30 October, D28; Reports, all but compliance status, on 30 October; Meetings and resolutions on 2 November). Screens that read them fail rather than fall back to simulated data, by design (docs/18 R-6).

| Not on the API yet | Screens it breaks | Slice |
|---|---|---|
| `OpsDataSource` | Platform operations | Platform |
| `ContractorNetwork` | Quotes from the Humo Contractor network | Contractor |
| `PaymentGateway` | Paying Humo invoices online (Payfast) | R-14 |

**How the two come together:**
1. **No screen fails because a feature isn't built yet** (done 28 October 2026). A screen whose data source isn't on the API says *Coming to Humo Property Management* and isn't in the menu in the live build: the list is `NOT_CONNECTED` in `http/provide-http-data.ts`, and a slice that lands removes its routes from it. Panels on shared pages (the dashboard, Levy billing rules) leave out what isn't built.
2. **A development seed on the API** (done 28 October 2026). The live system starts empty, so it looks broken next to the prototype's full demo agencies. `dotnet run --project backend/src/Humo.Api -- seed-demo` loads demo agencies (Acacia, Fynbos) through the API's own services, with the sign-ins listed in the backend README. Development only: it refuses anywhere else.
3. **A screen check in CI** (done 28 October 2026). The `screens` job runs the API with the development seed and the frontend against it; a browser (Playwright, `frontend/humo-web/e2e`) signs in as each seeded role and the System Administrator and opens every page in the menu. A page that shows an error, or any API 5xx, fails the build. Locally: with the API (seeded), Mailpit and `npm run start:api` running, `npm --prefix frontend/humo-web run e2e:screens`.
4. **One slice at a time** in the order of the table, each removing its data source from the "not on the API" list and its tags (docs/18).

**Compliance moves after version 1** (product owner, 13 November 2026). The Compliance screen stays out of the live menu (`NOT_CONNECTED`) until it's built; the financial year end it holds is already on the API. See §4.

## 2. Finance role (recommended 22 October 2026)

The Finance role can prepare **and** release supplier payments, and can **change a supplier's bank details**. Together, that lets one person redirect a payment to their own account and pay it. That's the most common fraud in property management.

**Recommendation:**
- **Maker and checker** (built with slice 3b, D27): whoever prepares a payment batch neither approves nor releases it.
- **Bank details** (built with slice 3b, D27): a changed bank account is held until someone else verifies it, and a batch made before the change can't be released.
- **Narrower reads** (built, D32): Finance keeps what it needs to answer owners and pay suppliers (accounts, statements, suppliers, resolutions, and a job opened from its invoice). It has no breaches, meetings, boards or compliance.

## 3. Later versions (asked for by the product owner)

The full list of what isn't in version 1 is in §4.

### Online trustee meetings (version 2 or 3)
- **Recommended:** self-hosted **Jitsi Meet** (open source, Apache 2.0) on Humo's own server in South Africa, embedded in the meeting page. Joining needs a short-lived signed token from Humo's API, so only invited trustees and staff get in.
- **Ties into governance:** attendance from who joined, quorum checked live, and the minutes and resolutions on the same meeting record.
- **Recording** (Jitsi's Jibri) needs its own server and a consent notice. Leave it for later.
- **Alternatives:** BigBlueButton (built for classrooms: heavier, more features), or LiveKit (a toolkit, more to build).

### More document templates
- Professional: **2** templates. Enterprise: **4**, plus **1** custom template made from the agency's designs.
- D23 (25 Oct 2026) already settles the custom part: Enterprise only, one custom template included, the separate add-on withdrawn. The ready-made choices are still to build.

### Humo Mobile
More than a security key:
- **Sign-in and approvals:** the passkey that signs in on a computer, and approving step-up actions from the phone.
- **Trustees:** approve quotes, payments and resolutions; read board packs; join meetings.
- **Residents:** statements and balances, report a problem with photos, notices, messages, documents, and later paying levies.
- **Staff in the field:** inspections and site visits with photos, offline, synced later (docs/13 field mode).
- **Push notifications** instead of SMS where the person has the app: free to send, so SMS is kept for those without it.

### WhatsApp
- It's a placeholder today: allowances are counted, but nothing is sent.
- **Needs:** a provider choice (Meta's WhatsApp Cloud API directly, or a South African provider such as Clickatell or Praekelt's Turn.io), Meta business verification, and Meta's approval of every business-started message template.
- **Built like SMS:** one provider behind a configurable interface, delivery reports into Sent, replies into the Inbox, opt-in recorded per person (POPIA).

### Humo Contractor
- A separate app (docs/20). Focus: contractors join and are vetted, receive invitations to quote (R-3, R-4), quote, accept work orders, upload completion photos and invoice.
- **Order:** after slice 3b (payables), because a contractor's invoice ends in the agency's payables.

## 4. Not in version 1 (to do after go-live)

Agreed with the product owner on 13 November 2026. Everything still open that isn't listed here is in version 1.

| Item | What it is | Notes or why it can wait |
|---|---|---|
| **Compliance** | The Compliance screen on the API: CSOS returns, insurance renewals, statutory deadlines, and the compliance status in Reports and on the dashboard. | **To do.** Hidden on the live system until built. Sits under Governance in the menu. |
| Online trustee meetings | Self-hosted Jitsi in the meeting page (§3). Recording later still. | Version 2 or 3. |
| Humo Mobile | Sign-in and approvals, trustees, residents, field staff, push notifications (§3). | |
| WhatsApp | A provider, Meta verification and approved templates (§3). Shown as *Coming soon* until then. | |
| Humo Contractor app and network | Contractors join and are vetted; invitations to quote (R-3, R-4); messages about a quote. `ContractorNetwork` stays off the API. | docs/20. Suppliers already quote by emailed link (D38). |
| D38 follow-ons | Completion photos and invoices through the supplier's link, payment status for the supplier, a free account in one click, Humo's own promotion after *Submit*. | Needs the Contractor app. |
| Contractor documents from their profile | A supplier's documents kept on their Humo Contractor profile and picked up by the agency; contractor packages. | Parked with the Contractor plan. |
| Sponsorships and other contractor revenue | Direct sponsorships (no ad networks), paid Contractor tier, featured listings. | After a few hundred live users. |
| Push alerts to Humo's administrators | Failure alerts on a Humo mobile app. Email alerts come first. | Needs Humo Mobile. |
| Platform › Feature flags, Platform health, System settings | Humo's own operations screens on the API (`OpsDataSource`). | Humo's staff only; switches and health can be handled on the server until then. |
| Document templates by package, and the Enterprise designer | Essentials usable, Professional updated, Enterprise the best, plus the agency's own design (HTML or a designer). Package-only templates. | Today's templates work; this needs a decision replacing D23 first. |
| Letters and notices as secure links | Collection letters and notices opened by link and code, like statements (R-1). | They're emailed today. |
| Meeting notices on the owner portal, as a PDF | R-16's later part. | The notice email works. |
| Bank layouts for the payment file, and posting payments to the scheme's cashbook | R-15's later part. | The standard file works for the first clients. |
| Generated files in the storage count | Statements and letters counted against storage (R-13). | Agreed to stay out of the count for now. |
| *Waiting on others* view | One view of everything waiting on someone else. | Comes after the review of where work waits (version 1 makes each item a task first). |
