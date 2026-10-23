# 28 · Roadmap

**Purpose:** what's next, in order, and what the product owner has asked for in later versions. Approved decisions stay in [docs/17](17-decisions.md); items here become decisions when they're scheduled.

**Last updated:** 22 October 2026.

## 1. Version 1: the live system as complete as the prototype

The prototype (`npm start`) runs every screen on simulated data. The live system (`npm run start:api`) runs only what's on Humo's API. Thirteen data sources aren't on the API yet. Screens that read them fail rather than fall back to simulated data, by design (docs/18 R-6).

| Not on the API yet | Screens it breaks | Slice |
|---|---|---|
| `PayablesDataSource` | Finance › Payables; the payables panel on the dashboard (since 22 Oct the dashboard shows without it) | 3b |
| `StaffDataSource` | Staff | Staff |
| `BudgetDataSource` | Finance › Budgets | Budgets |
| `ReportDataSource` | Reports | Reporting |
| `TimelineDataSource` | Timelines on records | Timeline |
| `MeetingDataSource`, `ResolutionDataSource` | Governance › Meetings and resolutions | Governance |
| `ComplianceDataSource` | Compliance | Compliance |
| `RulesDataSource` | Scheme rules and breaches | Governance |
| `OpsDataSource` | Platform operations | Platform |
| `PlatformTemplateDataSource` | Platform document templates | Documents |
| `ContractorNetwork` | Quotes from the Humo Contractor network | Contractor |
| `PaymentGateway` | Paying Humo invoices online (Payfast) | R-14 |

**How the two come together:**
1. **No screen fails because a feature isn't built yet.** A screen whose data source isn't on the API says *Coming to Humo Property Management* and isn't in the menu in the live build. Panels on shared pages (the dashboard) leave out what isn't built.
2. **A development seed on the API.** The live system starts empty, so it looks broken next to the prototype's full demo agencies. A seed command loads the same demo agencies (Acacia, Fynbos) through the API's own rules, so both can be compared screen by screen. Never in production.
3. **A route check in CI.** Sign in as each role against the API and open every screen in the menu. Any screen that shows an error fails the build. This is the check that found the five failing screens on 22 October.
4. **One slice at a time** in the order of the table, each removing its data source from the "not on the API" list and its tags (docs/18).

## 2. Finance role (recommended 22 October 2026)

The Finance role can prepare **and** release supplier payments, and can **change a supplier's bank details**. Together, that lets one person redirect a payment to their own account and pay it. That's the most common fraud in property management.

**Recommendation (to build with slice 3b):**
- **Maker and checker:** whoever prepares a payment batch can't release it. Release needs a second person (another Finance user or the Agency Administrator).
- **Bank details:** a changed bank account is held until someone else verifies it, and no payment to that supplier is released before then.
- **Narrower reads:** Finance keeps what it needs to answer owners and pay suppliers (accounts, statements, suppliers, maintenance jobs as read-only). It doesn't need governance or compliance screens.

## 3. Later versions (asked for by the product owner)

### Online trustee meetings (version 2 or 3)
- **Recommended:** self-hosted **Jitsi Meet** (open source, Apache 2.0) on Humo's own server in South Africa, embedded in the meeting page. Joining needs a short-lived signed token from Humo's API, so only invited trustees and staff get in.
- **Ties into governance:** attendance from who joined, quorum checked live, and the minutes and resolutions on the same meeting record.
- **Recording** (Jitsi's Jibri) needs its own server and a consent notice. Leave it for later.
- **Alternatives:** BigBlueButton (built for classrooms: heavier, more features), or LiveKit (a toolkit, more to build).

### More document templates
- Professional: **2** templates. Enterprise: **4**, plus **1** custom template made from the agency's designs.
- This changes D12 (custom templates are a paid Enterprise service). Record it as a new decision when scheduled.

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
