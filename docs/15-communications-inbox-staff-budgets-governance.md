# 15 — Communications, Inbox, Staff, Budgets and Governance boards (Checkpoint 10)

Status: **implemented in the frontend simulation** (October 2026).

Checkpoint 10 builds the remaining pages that showed the "Not built yet" card: Communications, Inbox, Staff, Budgets with the scheme Finance tab, Trustee boards and Scheme rules. The placeholder card itself now says *Not built yet* and names the permission and roles that will see the page, instead of a checkpoint number.

## 1. Communications (`/communications/compose`, `/communications/sent`, `/communications/templates`)

| Page | What it does |
|---|---|
| **Templates** | Starter and agency templates by category (reminder, statement, outage, AGM, request, welcome). Each has channels, a subject, a body with merge fields (`{person.name}`, `{unit.number}`, `{account.balance}`, …). *Use* opens Compose with it. |
| **Compose** | Scheme, audience (owners, residents, tenants, trustees, accounts in arrears by days, or chosen units), template, channels, subject and body with merge-field chips, now or scheduled. The **preview** counts recipients by channel, lists who can't be reached and why, shows a sample per recipient and warns on SMS length. |
| **Sent** | Everything Humo Property Management sent: composed messages, notices, statements, collection letters, reminders, Inbox replies and rule-breach warnings. Tabs: All, Not delivered, Scheduled. A message's page shows each delivery with its status; *Retry* failed deliveries and *Cancel* a scheduled send. |

- **Channel per person:** each person gets their preferred channel among those chosen, if it can reach them. The WhatsApp kill switch makes WhatsApp unreachable.
- **Delivery outcomes are deterministic** (about 3% of emails bounce and SMSs fail), so retries can be demonstrated.

## 2. Inbox (`/inbox`) and resident messages (`/my/messages`)

- **Conversations with residents:** two panes; the context strip shows balance, overdue amount, open jobs, preferred channel and links.
- **Reply** (with a template, optionally closing), **assign**, **close / reopen**, **turn into a job** (Maintenance) or **turn into a Task** (Follow-up).
- **A reply** goes through Communications (Sent kind *reply*) and closes the conversation's work item.
- **Residents write from the portal** (*Messages*). A new conversation opens a Task for the scheme's portfolio manager, or for whoever covers for them.

## 3. Staff (`/staff`, `/staff/:id`)

- **Each person's open work**, approvals and recent completions.
- **Away cover:** *X is away, Y covers from … to …* moves their open, non-approval work to the cover. New work (compliance Tasks, Inbox, credit control) is routed to the cover while they're away (`StaffStore.routeTo`). *X is back* moves still-open items back.
- **Permissions:** covering for yourself needs `Work.Manage`; setting cover for someone else also needs `Users.Manage`.

## 4. Budgets (`/finance/budgets`) and the scheme Finance tab

**A budget** is one scheme's income and expenses by category for one financial year (from the compliance profile's year-end).

| Status | Meaning |
|---|---|
| Draft | Lines can be added, changed and removed. |
| On the AGM agenda | *Put it to the AGM* links it to the AGM's budget agenda item (the standard *Budget and levies for the coming year* item, or a new one). The figures are fixed. |
| Approved | A passed resolution on that agenda item approves it. The budget shows the resolution. |

- **Actuals:**
  - Levies: the levy roll × months billed, compared with the budget for those months.
  - Expenses: supplier invoices paid; approved or in-batch invoices count as committed.
  - Insurance, municipal, audit and management fees aren't tracked yet ("Not tracked").
- **Brought forward:** schemes that moved to Humo Property Management mid-year carry the year's spending up to their first records, imported from the previous system (`Budget.broughtForward`).
- **Over budget:** a line is over when paid + committed exceeds the budget to date by 10% or more.
- **Visuals:** a bar per tracked line (paid, committed, budget-to-date marker), plus tables for income and expenses with variance, and the year's surplus or deficit.
- **Draft next year:** copies this year's lines with an increase %.
- **No open AGM:** *Put it to the AGM* offers to schedule one.
- **Approval cards:** maintenance approvals show the job's budget line with what's been spent.
- **Permission:** new `Budgets.Manage` (Agency Administrator, Portfolio Manager, Finance).

**Scheme › Finance tab:** levy roll and last billing run, receipts (last 30 days, to allocate, suspense), arrears by collection stage, payables (awaiting approval, approved, in a batch, paid) and the scheme's budgets. Each section links to the agency-wide page.

## 5. Trustee boards (`/governance/trustees`, `/governance/trustees/:schemeId`)

**Trustees are relationships** between a person and the scheme. Quorum, trustee approvers and the "trustees" audience all read the same records, so a board change applies everywhere at once.

| Action | Rules |
|---|---|
| **Add a trustee** | An owner (individual) in the scheme who isn't on the board. Either *elected* (must cite a passed resolution of the scheme) or *co-opted* by the board until the next AGM. One chairperson. |
| **End term** | Date and reason (resigned, sold their unit, not re-elected, removed, passed away). Their trustee access in Humo Property Management ends too. They stay under *Former trustees*. |
| **Portfolio** | Chairperson, Treasurer, Secretary, Trustee. |
| **Board size** | The minimum (default 3). |

- **Compliance:** a new **Trustee board** item (`CMP-…-BRD`) is *Overdue*, with a Task, while the board is below its minimum, and *Complete* otherwise. It links to the board.
- **Seed:** four Acacia boards start below the minimum (company owners can't be trustees), so the flow can be shown.

## 6. Scheme rules (`/governance/rules`) and the breach log

**Rules register (per scheme):**
- Every rule has a number, category, current wording, adoption date and **the resolution that adopted it**, plus its earlier versions.
- **Add:** cites a passed resolution, or is *captured from the registered rules* during onboarding.
- **Amend / Repeal:** must cite a passed resolution. Repealed rules stay in the register.
- **Share with owners:** publishes the rule book as a readable document in Documents (visible to owners and residents) and archives the previous copy. The page warns when rules have changed since the last share.
- **Upload rules PDF** (added 12 Oct 2026): the scheme’s **registered rules** as a PDF, the official document.
  - **Captured with it:** when the rules took effect, and how they were adopted (“Registered with the CSOS”, or the AGM resolution).
  - **Sharing:** shared with owners and residents, or kept staff-only for now.
  - **What it replaces:** the PDF goes to Documents (category *Rules*). A shared upload replaces what owners had; a staff-only upload leaves their copy in place.
  - **History:** earlier PDFs stay on record (archived) and are listed under *Registered rules* as earlier versions.
  - **The register stays:** add the rules you enforce one by one, because breaches cite a rule. When owners have the PDF, adding rules to the register doesn’t prompt to share again.
  - **Checks:** PDF only, within the upload limit, a date that isn’t in the future, and a note on how the rules were adopted. Needs `Meetings.Manage`, and it’s audited.
  - **Not in this version:** reading the individual rules out of the PDF into the register. That would need PDF text extraction, and OCR for scanned rules.

**Breach log (all schemes in scope):**

| Step | What happens |
|---|---|
| Log | Rule, unit, owner or tenant, when, what happened. Nothing is sent. |
| Warning | A letter (email through Communications, or post, which is recorded) with a date to put it right. The letter states the date. A Task reminds the portfolio manager to check on that date. |
| Final warning | Only after a first warning. |
| Refer to the trustees | The trustees get a Task to decide the next step (e.g. a CSOS application). |
| Resolve / Reopen | With a note. |

- **No fines.** Humo Property Management records breaches and warnings only; consequences are the trustees' decision.
- **Repeat breaches** of the same rule at the same unit are counted.
- **Permission:** new `Rules.Enforce` (Agency Administrator, Portfolio Manager). Rules and boards are changed with `Meetings.Manage`.

## 7. Naming

Text written in this checkpoint follows [07 — Brand architecture](07-brand-architecture.md). The checkpoint's final pass also corrected older strings that used bare "Humo" for this application:
- the maintenance notice placeholder (and notices already saved with it)
- *Sign out of Humo Property Management* and the signed-out page
- compliance, billing, credit control, Sent, roles and profile wording
- the comms template subject
- the system actor in compliance Tasks ("Humo PM")

## 8. API (for the backend)

| Endpoint | Permission |
|---|---|
| `GET/POST /templates`, `POST /messages/preview`, `POST /messages`, `GET /messages`, `POST /messages/{id}/retry`, `POST /messages/{id}/cancel` | `Messages.Reply` |
| `GET /conversations`, `POST /conversations/{id}/actions`, `GET/POST /me/conversations` | `Messages.Reply` / `Resident.Portal` |
| `GET /staff`, `POST /staff/{id}/cover`, `DELETE /staff/{id}/cover` | `Work.Manage` (+ `Users.Manage` for others) |
| `GET /budgets`, `POST /budgets`, `POST /budgets/{id}/actions` | `Finance.View` / `Budgets.Manage` |
| `GET /boards`, `GET /boards/{schemeId}`, `POST /boards/{schemeId}/actions` | `Governance.View` / `Meetings.Manage` |
| `GET /rules/{schemeId}`, `POST /rules/{schemeId}/actions` | `Governance.View` / `Meetings.Manage` |
| `GET /breaches`, `POST /breaches`, `POST /breaches/{id}/actions` | `Governance.View` / `Rules.Enforce` |

Commands carry the record's version where one exists (409 on conflict), are validated server-side (field errors) and audited.

## 9. Known limits

- Budget actuals don't yet include insurance, utilities, management fees or audit (no ledger for those in the simulation).
- Inbound email/SMS isn't simulated: resident messages arrive through the portal only.
- The initial bundle is 1.34 MB, over the 1.2 MB warning budget (the error limit is 2 MB). Lazy-loading the mock stores would bring it down; this was left for a dedicated change.
