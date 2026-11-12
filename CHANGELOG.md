# Changelog

What changed in Humo Property Management, release by release, in plain language. Pull request numbers are in brackets.

**Versions.** `0.x` until the first client goes live; that release is **1.0.0**. After that, the middle number goes up for new features and the last for fixes. The version is in [contracts/version.json](contracts/version.json) and shows on the sign-in page, in the account menu and from `GET /api/health`. How to release: [CLAUDE.md](CLAUDE.md#versions).

## Unreleased

- Communications › Templates is renamed **Message templates**, and Compliance moves under **Governance** [#PR]
- Levy billing rules moves from Settings to **Finance › Billing rules**; the old address still opens it [#113]
- Staff is its own menu item, **Team**, instead of sitting under Portfolio [#112]
- Humo's menu is grouped (Customers, Business, Product, People, Operations), with System under Operations. Settings holds the agency's settings, with Plan & billing beside it; My profile and Security are in the account menu only [#111]
- Humo's menu keeps Platform health, the Audit log and Technical logs together at the end [#110]
- A problem shown off screen (further up a long page, or in a drawer) also comes up as a toast, with Show to scroll to it [#109]
- The email address on the sign-in screens stays on one line instead of breaking mid-word [#107]
- Suppliers quote, revise, decline and confirm work orders through an emailed link, without an account. Staff choose which photos go; the address is only on work orders; links close once the quote is decided (D38) [#106]
- Version numbers and this changelog. The version shows on the sign-in page and in the account menu, and `GET /api/health` returns it, so you can check the server and the web app match after a deploy.

## 0.9.0 · 11 November 2026 · Maintenance controls

- Maintenance photos are stored, shown on the job and counted against storage (D37) [#98]
- A supplier with no documents isn't vetted [#99]
- A task for real work can't simply be ticked off [#100]
- Technical logs for the API (Serilog) [#101]
- Spending above a scheme's limit goes to the board to approve (D39) [#102]
- Resolving an owner's dispute, and correcting an account with a second person or the board (D40) [#103]
- Correcting a quote, asking for a revision and new quotes after a rejection (D41) [#104]
- The notifications header stays above the list as it scrolls [#105]

## 0.8.0 · 7 November 2026 · Ownership, rules and roles

- Feature switches catch up after a failure and on sign-in [#85]
- Receipts: reverse or move an allocated payment with a reason; the ledger is never edited [#86, #87]
- History shows real times; the cooling-off notice names the trustees told [#88]
- The trustee register on every plan, scheme rules in Professional (D29) [#89]
- Adding a passkey needs an existing one, with clearer explanations (D30) [#90, #91]
- Scheme rules and the breach log on the API [#92]
- What Finance can read, and the Staff lock (D32) [#93]
- Someone with no property left stays signed in (D33) [#94]
- Changing someone's email, confirmed and audited (D34) [#95]
- When a unit changes hands; a unit always has an owner; one ownership per person (D35, D36) [#96, #97]

## 0.7.0 · 30 October 2026 · Payables, staff, budgets, reports and governance

- Supplier payments on the API, with maker and checker and verified bank accounts (D27) [#76]
- Staff with their workload and away cover [#77]
- Budgets, with the owners' approval recorded (D28) [#78]
- Reports and real scheme health [#79]
- Meetings, resolutions and their actions [#82]
- Fixes: the passkey form covering Security, statements going to a previous owner, an unwanted passkey prompt, owners seeing only one unit, billing screens hidden on the live system [#80, #81, #83, #84]

## 0.6.0 · 28 October 2026 · Getting ready for real use

- Measured storage on the plan page; an agency is activated only with an accepted administrator [#56]
- Uploads work locally with the virus scanner, and refusals say why [#57]
- Agency email signatures and each sender's sign-off [#58]
- Custom document templates are Enterprise only (D23); approving with one authoriser (D24) [#59, #60]
- Clearer passkey messages; invitations can be accepted again [#61, #62]
- One owner with several units, owner changes, and people on a unit [#63, #64, #65]
- Platform › Document templates on the API; storage in MB; switched-off SMS not counted [#67, #68]
- Go-live checks: no test modes in production [#69]
- Owners pay levies online through the scheme's own Payfast (D25); statement codes by email [#70, #71]
- Approvals confirmed by SMS code when no passkey is to hand (D26) [#72]
- Notes and timelines on the API, "coming soon" for unfinished screens, a development seed, and a screen check in CI [#73, #74, #75]

## 0.5.0 · 22 October 2026 · Maintenance, secure links and files

- Maintenance jobs and suppliers on the API [#41]
- Owners open statements through a secure link with a one-time code; staff can revoke it [#42, #45]
- Sign-in link codes, session limits, trusted computers and delivery results [#43, #44]
- Uploaded PDFs are virus-checked and stored on the server; the document library [#46, #47, #48]
- Package limits (D16) and storage limits (D20) [#49, #51]
- Basic owner invoicing on Essentials; the Advanced finance add-on (D21, D22) [#50, #52, #55]

## 0.4.0 · 20 October 2026 · Money on the API

- Humo invoices and manual EFT; approved prices (D15); Payfast online payment; the billing run and card debit orders [#30, #31, #32, #33]
- The levy-account ledger and receipts; levy billing runs, meter readings and levy settings; statements and document templates [#34, #35, #36, #38]
- Credit control, with statements and letters recorded in Communications › Sent [#39]
- Communications on the API, SMS bundles and allowances [#40]

## 0.3.0 · 19 October 2026 · The live foundation and Humo's API

- A production build without demo data; access by assignment (D1) and the board register (D2); South African dates; CI [#22, #24]
- Sign-in and hosting decision (D14) and the operations handover [#23]
- The .NET 10 API: passkey and email-link sign-in, the command pipeline, organisations, schemes, units, people, boards, users and access, new accounts, notifications, the Humo team, impersonation and the audit log [#25, #26, #27]
- Notices emailed to the people they're for; the commercial catalogue, subscriptions and agreements on the API [#28, #29]

## 0.2.0 · 13 October 2026 · Accounts, billing inputs and the commercial model (prototype)

- Humo Contractor separated into its own app [#9]
- New customer accounts, with approval and delegated activation [#10, #11, #12, #13]
- Billing inputs: receipt capture and bank-statement import, meter readings, and the levy model per scheme (D13) [#14, #15, #16, #17]
- The registered scheme rules PDF [#18]
- Commercial management: pricing, agreements, storage quotas and Humo's invoices [#19, #20]
- Refreshes and deep links work in every build [#21]

## 0.1.0 · 10 October 2026 · The prototype

- The Humo Property Management prototype on simulated data: the app shell, navigation by role, and checkpoints 1–10 [#1, #3, #4, #5]
- A demo build with working send actions and statement previews [#6]
- The sign-in page: passkey first, an emailed link as the fallback [#7, #8]
