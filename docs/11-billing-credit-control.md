# 11 — Billing run and credit control (Checkpoint 6)

Status: **implemented in the frontend simulation** (October 2026).

**Two flows.**
- **The billing run** (review finding F15): Scope & period → Charges preview → Exceptions → Approval (in Approvals) → Post (locked) → Send statements.
- **Credit control** (review finding F13): Reminder → Final demand → Letter of demand → Handed over, with Payment arrangement and Disputed beside the pipeline.

Both are in `docs/02-ux-review.md`. Letters are template-driven A4 documents (`docs/document-template-architecture.md`).

## 1. The billing run

| Concept | What it is | Where |
|---|---|---|
| **Run** | One month's charges for one scheme (`BR-KC-2611`): one line per account, the exceptions, the approval, the posting and the statements | `BillingRun` in `domain/models/billing.ts` |
| **Lifecycle** | Preparing → Awaiting approval → Approved → Posted → Statements sent (or Cancelled) | `BILLING_STAGES` |
| **Charges** | Levy, special levy instalment, water (metered, or the 3-month average when estimated), interest on overdue amounts at 2% a month | `Charge`, calculated by the API (`BillingStore.prepare()` in the simulation) |
| **Exception** | Something unusual about one account that a person must decide before approval. Each kind has its own sensible options; the usual choice is listed first | `BillingException` |
| **Posting** | Writes every included line to the accounts, dated the 1st of the period, and **locks** the run | `MockDb.postCharges()` |
| **Correction** | After posting, a **journal adjustment** on the account, with a reason. Never an edit to the run | `BillingDataSource.adjust()` |

**Exception kinds**

| Kind | Raised when | Options |
|---|---|---|
| No meter reading | A metered unit has no reading for the period | Bill an estimate · Leave out |
| Levy changed | The levy differs from last month's (check the trustees approved it) | Bill as calculated · Leave out |
| Payment arrangement | The account is on an arrangement | Bill, but no interest · Bill as calculated |
| With the attorney | The account has been handed over (the statement is copied to the attorney) | Noted — bill as calculated · Leave out |
| Large credit balance | In credit by more than three months' charges (consider a refund) | Noted — bill as calculated |
| No owner on record | The unit has no account holder | Leave out |

**Rules the API enforces.** In the simulation they live in `BillingStore.check()` / `checkCreate()` and run through `MockGateway`, alongside the `Billing.Run` permission, the `billing` entitlement, the version (409) and the audit.

| Rule | Detail |
|---|---|
| **One run at a time** | A scheme can't have two runs in progress. |
| **Periods in order, once** | Only the scheme's next period can be prepared. |
| **Decide every exception** | The run can't go for approval while an exception is undecided, or if nothing would be billed. |
| **Approval in Approvals** | Never on the run page. Approvers are agency administrators and finance (`billing-run-approval`). Large amounts need step-up. |
| **Post only when approved** | Posting locks the run. A posted run can't be cancelled. |
| **Statements after posting** | Each statement records the template version it was issued with. |
| **Journal adjustments** | Need a reason of at least 5 characters and are capped at R 100 000; bigger corrections need a correction run. |

## 2. Credit control

| Concept | What it is | Where |
|---|---|---|
| **Case** | One per account in arrears: its stage, every step taken, the arrangement or dispute, the trustees' approval of a letter of demand | `CollectionCase` in `domain/models/collections.ts` |
| **Stage** | Not started → Reminder → Final demand → Letter of demand → Handed over; side states Payment arrangement and Disputed (which remember the stage to return to) | `CollectionStage` |
| **Next action** | What to do and when it's due: 14 days between letters (`STEP_DAYS`), a reminder the day an account falls into arrears, a monthly check once handed over | `CollectionView.next` |
| **Follow-up Task** | One open Task per active case, assigned to the credit controller (Zanele Dlamini, Finance), or else the scheme's portfolio manager. Taking the next step closes it and opens the next | `CollectionsStore.syncFollowUp()` |
| **Letter** | Each reminder, final demand and letter of demand is a payment-notice document, frozen with the amount, ageing, pay-by date and template version at the time it was sent | `CollectionStep.letter` |

**Rules**

| Rule | Detail |
|---|---|
| **Letters in order** | Reminder, then final demand, then letter of demand. Only the next letter can be sent, and only while something is overdue. |
| **Letter of demand needs the trustees** | *Ask the trustees* creates a `demand-approval` item in Approvals for the scheme's trustees and agency administrators. Approved: the letter can be sent. Declined: the case stays at final demand. |
| **Hand-over** | Only after a letter of demand. Needs the attorney's name. |
| **Arrangement** | Instalment × months must clear what's overdue; day 1–28; up to 24 months. A missed instalment returns the case to where it was. |
| **Dispute** | Pauses collection until resolved (amount stands, or partly written off by journal). |
| **Bulk reminders** | Select accounts on the pipeline → *Send reminders* by email or SMS. Only accounts not yet started get one. The others are skipped, and the count sent is reported. |

Everything is behind `Collections.Manage` (Agency Administrator, Portfolio Manager, Finance) and the `credit-control` entitlement.

## 3. How the pieces connect

- **Billing → accounts.** Posting adds the charges to each account's ledger (reference `BR-…`) and rebalances it. The latest month billed counts as current; older amounts age by month.
- **Accounts → credit control.** Anything 30+ days overdue appears on the pipeline. Paying up removes the account; arrangements and hand-overs stay until the balance is cleared.
- **Billing → statements.** *Send statements* records the issuing template per account and period. The statement page renders with that version.
- **Approvals.** Billing runs and letters of demand sit beside quotes, invoices and minutes. A decision moves the run or case on: Approved, or back to Preparing with the comment logged.
- **Account page.** Shows the collection stage and next action with a link to the case, and a *Journal adjustment* button (`Billing.Run`).

## 4. Documents

| Document | Template | Notes |
|---|---|---|
| **Payment notice**: reminder, final demand or letter of demand. Addressee, account, amount overdue, pay-by date, the ageing, how to pay (the scheme's trust account), signed for the trustees | `payment-notice.standard` (Standard, `payment-notice/classic`), `payment-notice.professional` (Premium, `payment-notice/branded`) | Wording firms up at each step. Rendered on the shared A4 sheet (`document-sheet.scss`). |

## 5. Screens

| Screen | Who | What |
|---|---|---|
| **Finance › Levies & billing** | `Billing.View` | Levy roll, runs in progress, schemes not yet prepared. Tabs: **Schemes** (last posted, current run, *Prepare (month)*) and **Runs**. *New billing run* (`Billing.Run`); `/finance/billing/new` opens it. |
| **Billing run** | Same; actions need `Billing.Run` | Stage tracker; the next step; locked banner once posted; exceptions with *Decide*; charges by kind with the change vs last month, and per account (All · Flagged · Left out); statements by channel and template; activity with comments. |
| **Finance › Credit control** | `Billing.View`; actions need `Collections.Manage` | Arrears by age (chart + age filter), KPIs, stage tabs (Needs action · each stage · All), selectable table with bulk reminders. |
| **Collection case** | Same | Stage tracker, the next step and its actions, ageing, letters, owner contact, history with notes. |
| **Letter** | Same | The A4 letter as sent, with its template version, *Print or save PDF*. |
| **My work › Approvals** | Agency admin, finance (runs); trustees, agency admin (letters of demand) | With the evidence: exceptions report, last month's total, letters already sent. |
| **My work › Tasks** | The credit controller | Collection follow-ups, linked to the case. |

## 6. Seed data

- **History.** Every scheme has this month's run posted and sent (no per-account lines kept for these; the run page says so).
- **Waterkloof Ridge Estate.** Next month's run is awaiting approval, replacing fixture approval w07.
- **Collection cases**, replacing fixture tasks w04–w06 with the same ids:
  - **KC-031:** final demand sent; next, ask the trustees.
  - **JH-008:** on a payment arrangement.
  - **MC-044:** the trustees approved a letter of demand; send it.
  - **Kingfisher Court:** three accounts at reminder stage.
  - **The Willows:** one account disputed.

**Reset needed for older simulated data.** Browsers with simulated data from before this change need **Reset simulation** (prototype toolbar) so the old fixture tasks give way to the seeded runs and cases.

## 7. Walkthrough

1. **As Priya Naidoo (Finance)**, open Finance › Levies & billing → Kingfisher Court → *Prepare November*:
   - Two water readings are missing. **Decide** each (estimate).
   - **Send for approval.**
2. **In Approvals**, *Verify and approve* the run (step-up).
3. **Back on the run**, **Post** — the run locks — then **Send statements**.
4. **Open an account** (e.g. Kingfisher Court unit 12) → *Journal adjustment* to correct a charge. It appears in the ledger with the reason.
5. **Finance › Credit control:**
   - Filter by 90+ days.
   - On *Not started*, select three accounts → **Send reminders**.
6. **MC-044** → **Send letter of demand** by post → open the letter.
7. **KC-031** → **Ask the trustees**. As Sipho Khumalo (Trustee), approve it in Approvals. As Priya, send the letter of demand, then **Hand over**.

## 8. Known gaps (for the backend)

- **Ageing is approximated.** Months are estimated from the monthly charge, with the latest month billed as current. The API will age the actual transactions.
- **Charge rules.** Interest rate, estimate method and step days are prototype constants. They belong in Settings › Billing configuration.
- **Segregation of duties.** The person who prepared a run can currently approve it. The API should refuse that.
- **Delivery.** Sending statements and letters is recorded, not delivered; Communications › Sent will show delivery.
