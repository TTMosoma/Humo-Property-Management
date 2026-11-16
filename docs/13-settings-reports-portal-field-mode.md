# 13 — Settings, Reports, resident portal and field mode (Checkpoint 8)

Status: **implemented in the frontend simulation** (October 2026).

Checkpoint 8 finishes the planned staff and resident pages. Some of it was already built under "Experience integration":
- role-aware dashboard and resident Home;
- the phone tab bar;
- Users, Roles, Security, Audit, Plan and Documents settings;
- the Platform console.

This checkpoint adds four parts, built in this order:

| Part | What | Review finding |
|---|---|---|
| **B. Settings** | My profile, Agency, Notifications, Billing configuration | Checkpoints 6–7 gaps |
| **A. Reports** | One catalogue of 13 reports, with filter, print and CSV | F7 |
| **C. Resident portal** | Notices, Documents, live notifications | F20, F24 |
| **D. Field mode** | Report tab with photo-first capture; "best on a bigger screen" notes | F31 |

Platform feature flags and platform health stay in Checkpoint 9.

## B. Settings

| Page | Who | What |
|---|---|---|
| **My profile** (`/settings/profile`) | Everyone (`Security.ManageOwn`) | Name, email, title and roles (read-only; managed in Users & access). Notification preferences: channels for Tasks and approvals (email, Humo Mobile, SMS); a daily or weekly summary email; quiet hours for SMS and push. |
| **Agency** (`/settings/agency`) | `Organisation.Manage` | Registered details: name, trading name, CIPC number, VAT, PPRA Fidelity Fund certificate, address, contact. **Trust accounts** per scheme. Changing one needs step-up (`change-bank-details`), is audited as a security event, and shows *Awaiting bank letter* until verified. Statements and collection letters use the new account. |
| **Notifications** (`/settings/notifications`) | `Notifications.Configure` | Per event (payment received, statement issued, request updated, new notice, new document, collection letters, approval waiting, compliance due): on or off, and the channels. Collection letters can't be switched off. A rule that's on needs at least one channel. |
| **Billing configuration** (`/settings/billing`) | `Billing.View` (rules editable with `Billing.Run`; years with `Compliance.Manage`) | Interest on arrears (% a month), billing day, due day, days between collection letters, the AGM deadline in months. **Financial years:** each scheme's year-end and whether it has lifts. |

**The rules are no longer constants.** Each module reads them from `SettingsStore` when it runs, so changing a setting changes the next run, letter or check:

| Setting | Read by |
|---|---|
| Interest rate | `BillingStore.prepare()`, in each run's interest charge |
| Step days | `CollectionsStore` for next actions; letter wording through `CollectionView.stepDays`. `STEP_DAYS` is gone from the domain. |
| AGM months | `ComplianceStore` deadlines |
| Billing and due days | The dashboard's money cycle |
| Year-end, lifts | `ComplianceStore` regenerates the scheme's items immediately |

Trust account overrides live in `MockDb.trustAccount(scheme)`.

## A. Reports

**One catalogue** (`/reports`, and each scheme's *Reports* tab).
- **What you see:** only the reports your role and your agency's plan allow (`Reports.View`, plus each report's own permission and feature). The catalogue is grouped by category.

| Category | Reports |
|---|---|
| Financial | Levy roll · Billing summary* · Receipts* · Supplier payments* |
| Arrears | Age analysis · Debtors list (personal information; `Accounts.View`) · Collection pipeline (`credit-control`) |
| Maintenance | Jobs by stage · Supplier performance |
| Governance & compliance | Resolutions register (`governance`) · Compliance status (`compliance`) |
| Portfolio | Scheme health · Units & occupancy |

\* Have a period: last 1, 3, 6 or 12 months.

**Report page** (`/reports/:id`):
- **Filters:** schemes (all in scope, or one) and period.
- **Table:** sortable columns, with a totals row.
- **Links:** rows open their record (scheme, run, supplier, debtor, meeting).
- **Explaining the figures:** notes say how they were worked out.

**On the API (30 October 2026):** `GET /reports` (the catalogue the person may run) and `GET /reports/{id}?schemeIds=…&months=…` (the report from live records, with its totals). The resolutions register and compliance status join the catalogue with the governance and compliance slices. Age analysis ages each account's actual transactions; levies billed come from the ledger. CSV export stays in the browser.

**Scheme health** (the dashboard, the scheme pages and the report) is worked out by the API from the records: collected ≈ 1 − unpaid from the last three months ÷ three months' levies; arrears 30 days and older; accounts 90 days and more; open and overdue jobs. At risk under 85% collected; watch under 95%, or with accounts 90+ days or overdue jobs. Compliance joins the rating when it's on the API.
- **Output:** *Export CSV* (raw values, UTF-8 with BOM, built in the browser) and *Print*.

Every report is worked out from the same live records the screens use (`InMemoryReportDataSource`), so a report never disagrees with a page.

## C. Resident portal

| Page | Who | What |
|---|---|---|
| **Notices** (`/my/notices`) | Owners and tenants | Current notices for their scheme, pinned ones first. Tenants don't see owners-only notices. Expired and withdrawn notices aren't shown. |
| **Documents** (`/my/documents`) | Owners and tenants | *My unit*: documents shared with "this unit only". *The scheme* (owners only): documents shared with owners. |
| **My requests** (`/my/requests`, and each one at `/my/requests/:ref`) | Owners and tenants | Their own requests, with a progress tracker; *Was it fixed?* once the supplier is done. Each opens on its own page: its status (and the reason, if it was cancelled), the booking, what the supplier says, the photos and a plain history. Live system (15 November 2026): the API sends residents only this (`/me/jobs`, `Maintenance/ResidentRequests.cs`), never the quotes, prices, approvals, invoices, staff notes or the supplier's contact and bank details. |
| **Notifications** (the bell) | Owners and tenants | Worked out from live records, only for events the agency's rules switch on: payments allocated, statements sent, their requests moving on, notices, documents shared, collection letters. Last 45 days. |
| **Communications › Notices** (`/communications/notices`), also each scheme's *Communications* tab | Staff (`Communications.View`; publish with `Messages.Reply`) | Current and past notices with audience, recipient count and channels. *New notice*: scheme, audience (owners and tenants, owners only, trustees), category, headline, text, pin, end date. *Pin / Unpin*, *Withdraw* (with a reason). |

**A resident hears about their own request** (live system, 15 November 2026). Whoever reported it is told, in the bell, when it's being arranged, booked, done (*Was it fixed?*), sent back to the supplier, and cancelled or closed (closed only if they hadn't confirmed it). **Booked, done, and cancelled or closed also go by email**, when the agency's *Request updated* rule (Settings › Notifications) has email on and the resident hasn't turned email off. With the rule switched off, they still see it in the app. Staff see a hint under *Cancel* that the resident is told the reason.

**Visibility is enforced in the data layer, as the API will.**
- **Trustees** see documents shared with trustees or owners (no staff-only ones, no unit ones).
- **Residents** see only what's shared with them.
- **Staff** see everything.

**Sending a notice.** A notice goes out by the channels the *New notice* rule has at the moment it's published; they're recorded on the notice.

## D. Field mode

- **Report tab:** staff who log jobs (not Finance) get *Report* on the phone tab bar: Tasks · Approvals · Report · Search · More.
  - Home moves into More. Search stays, because the phone top bar hides it.
  - Operations keep Home and Jobs: Home · Jobs · Report · Search · More.
- **Photo first:** *Report* opens the request form with the photo on top (`?capture=1`). *Take or add a photo* uses `capture="environment"`, so a phone opens its camera. The prototype keeps the photo's name, not the image.
- **"Best on a bigger screen":** a note on phones (under 700px) on the billing run, report pages, the compliance matrix and billing configuration. The key facts stay below it.
- **Tab highlighting:** the tab bar now picks the most specific match, so */maintenance/new* highlights Report rather than Jobs.

## Also fixed

- Four icons used since Checkpoint 7 weren't registered (pricetag, arrow up/down, checkbox). Pin was added.
- Notice numbers continue from the scheme's highest (`NTC-KC-10`), not from a count.

## Walkthrough

1. **Reset the simulation.** As **Thandeka** (Agency Administrator):
   - **Settings › Agency** → change Kingfisher Court's trust account (step-up) → it shows *Awaiting bank letter*.
   - **Settings › Billing configuration** → interest to 1.5%. The next billing run charges 1.5%.
   - **Settings › Billing configuration** → change a scheme's year-end, then open its AGM compliance item.
   - **Settings › Notifications** → untick every channel for *Request updated* and save, to see the rule refused.
2. **Reports:**
   - **Debtors list** → sort by Overdue → *Export CSV*.
   - **Scheme health** → open a scheme from its row.
3. **As Johan:** **Communications › Notices** → *New notice* for Kingfisher Court (owners and tenants).
4. **As Anele (owner, KC-042):**
   - **Notices:** the new notice is there.
   - **Documents:** the clearance letter on her unit, and the conduct rules.
   - **The bell:** notices, the shared document, her statement, her request's progress.
5. **As Ruan (tenant):** no owners-only notices and no scheme documents.
6. **On a phone-sized window as Johan:** *Report* opens photo-first. A billing run shows the "bigger screen" note.

## Known gaps

- **Delivery.** Notices and notifications are recorded, not sent. Communications › Sent and Compose stay planned.
- **Reports.** No scheduled or saved reports (advanced reporting). CSV is built in the browser; the API will stream it.
- **Personal preferences.** Saved, but the prototype doesn't send email, SMS or push, so quiet hours aren't applied.
- **Bundle size.** The initial bundle is 1.25 MB, 49 kB over the 1.2 MB *warning* budget (the error limit is 2 MB). The simulated data layer (settings, notices, reports, resident notifications) loads at startup and won't with the HTTP data layer.
