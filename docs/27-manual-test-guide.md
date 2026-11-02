# 27 · Manual test guide

**Purpose:** the checks the product owner runs by hand against the local stack before a release. The automated tests cover the rules; this guide covers what only a person can judge: the screens, the emails and SMS, and whether it all makes sense. Tick each box, and note anything that differs from **Expect**.

**Last updated:** 2 November 2026 (section 17: meetings and resolutions; sections 10 to 16: the demo agencies, supplier payments, Staff, Budgets, Reports).

## 0. Set up

1. Start PostgreSQL, Mailpit and ClamAV (uploads are refused without it), the API and the web app (or use the local `.bat` files, in their numbered order):
   ```bash
   docker compose -f backend/deploy/docker-compose.dev.yml up -d
   dotnet run --project backend/src/Humo.Api --launch-profile http
   npm --prefix frontend/humo-web run start:api
   ```
2. Open http://localhost:4310 and sign in as `terry@humo.co.za`. The sign-in email arrives in Mailpit: http://localhost:8025.
3. **One test agency on Humo Essentials** (Platform › Customers). Use made-up people, **except one test owner who gets your own mobile number and email address**: section 6 sends real SMS when SMSSouthAfrica is configured, and each one counts in that agency's SMS for the month.
4. For that agency: one scheme with a trust account (Settings › Agency › Trust accounts), a few units, and the test owner on one unit.

Sections run in order: section 3 starts the Professional trial, which sections 4 to 6 need.

## 1. Package limits (D16–D18)

- [ ] **Units warning:** add units until the agency has 40. **Expect:** staff see a banner "40 of 50 units"; the administrator gets an email and a bell notification.
- [ ] **Units refused:** try to add a 51st unit. **Expect:** refused, with a message naming Humo Essentials.
- [ ] **People limit:** invite people until there are 5 with a sign-in, then try a sixth. **Expect:** the sixth is refused (inviting asks for your passkey first).
- [ ] **Storage:** upload a PDF in Documents. **Expect:** the storage figure goes up (also visible at `GET /api/me/limits`).

## 2. Advanced finance add-on (D21, D22)

- [ ] **Approve the price on an existing database:** in Platform › Pricing & add-ons, open *Advanced finance*. If it still says *proposed*, set it to **approved** at R400 a month, effective today, with a reason. **Expect:** saved, and the change is in the audit log. (A freshly seeded database already shows it approved.)
- [ ] **Buy it for the Essentials agency** (Customer › Billing & agreement). **Expect:** Levies, billing runs, payment allocation, debtors and credit control appear. Suppliers, payables and budgets do not.

## 3. Professional trial (D17)

- [ ] At 80% of a limit the banner offers *Try Humo Professional free for 30 days*. Start it. **Expect:** the banner changes, Maintenance (advanced), Suppliers and Payables appear, and no second trial is offered.

## 4. Library and invoicing (R-11, D19)

- [ ] **Library:** upload, edit, archive, restore and open a document on a scheme. **Expect:** each step works and the document opens through a link.
- [ ] **Invoice an owner:** issue an invoice to the test owner. **Expect:** numbered INV-0001.
- [ ] **Payment:** record a payment against it, then try to pay more than is owed. **Expect:** the overpayment is refused.
- [ ] **Email the invoice.** **Expect:** it arrives in Mailpit.

## 5. Maintenance and suppliers (slice 3a)

- [ ] **Add a supplier** (Suppliers › Add supplier) for the scheme, leaving a compliance document missing.
- [ ] **Log a job** (Maintenance › Log a request). **Expect:** reference MR-1001; a triage task in My work.
- [ ] **Quote and approve:** request a quote from the supplier, record a quote **under R5 000**, approve it. **Expect:** approved without the trustees.
- [ ] **Above the delegated limit:** on a second job, record a quote **over R5 000** and send it for approval. **Expect:** it waits in My work › Approvals for a trustee or the agency administrator.
- [ ] **Work order with a missing document:** issue the work order. **Expect:** a vetting warning; it only goes ahead when you tick the override, and the job's timeline records "Issued despite vetting".
- [ ] **Finish the job:** start, complete, verify on the resident's behalf. **Expect:** each stage shows on the job.
- [ ] **Invoice over the quote:** capture an invoice above the quoted amount. **Expect:** it goes back for approval. Capturing the same invoice number twice for this supplier is refused.
- [ ] **Supplier on hold:** put the supplier on hold. **Expect:** it can't be given new work.
- [ ] **Bank details:** change the supplier's bank details. **Expect:** asks for your passkey; the account shows as unverified.
- [ ] **Inbox to job:** as the test owner (resident portal), send a message; as staff, turn it into a job. **Expect:** a new MR job, linked from the conversation.

## 6. Statements by secure link (R-1)

- [ ] In Settings › Documents, set *Emailed statements* to **A secure link (opens with a one-time code)**.
- [ ] Open the test owner's statement for this month and choose **Email to owner**. **Expect:** an email in Mailpit with a link to `/d/…`, no attachment.
- [ ] **Open the link in a private window** (signed out). **Expect:** only the statement's name, the scheme and agency, and "the number ending …": no amounts.
- [ ] **Send me a code.** **Expect:** an SMS to your phone within a minute (or, if the owner has no mobile, an email). Asking again straight away is refused for a minute.
- [ ] **Email instead:** on a fresh link for an owner with both a mobile and an email, choose **Email it to s•••@… instead**. **Expect:** the code in Mailpit, no SMS, and no SMS counted. After an SMS, **No SMS? Email it** works once the minute is up.
- [ ] Enter a **wrong** code. **Expect:** "That code isn’t right. 4 tries left."
- [ ] Enter the **right** code. **Expect:** the statement shows, and **Download PDF** saves it.
- [ ] **Sent shows it read:** Communications › Sent, the statement's delivery. **Expect:** *read*.
- [ ] **On a phone:** open the same link on your phone. **Expect:** readable without zooming sideways.

## 7. Paying levies online (D25)

Needs a Payfast **sandbox** merchant (register at sandbox.payfast.co.za, set a salt passphrase there) and the API with `Payments:Payfast:Sandbox=true`. Payfast's notification needs a public address: run it on staging, or use a tunnel to your machine.

- [ ] As the agency admin, Settings › Agency › Trust accounts: **Set up Payfast** on a scheme, with the sandbox merchant ID, key and passphrase. **Expect:** a passkey prompt; then *Online payments: Payfast …*.
- [ ] As an owner in that scheme, My account. **Expect:** the scheme's real trust account under *Or pay by EFT*, and **Pay R … with Payfast**.
- [ ] Pay with Payfast's sandbox test card. **Expect:** back on My account with "Payfast is confirming your payment"; within a few minutes the balance drops and Recent activity shows *Card payment received*.
- [ ] Finance › Receipts. **Expect:** an allocated receipt from *Payfast (card)*.
- [ ] Cancel on Payfast's page instead. **Expect:** "The online payment was cancelled. Nothing was charged."
- [ ] **Turn off online payments** on the scheme. **Expect:** owners see EFT only.

## 8. Confirming without your passkey (D26)

- [ ] My profile › **Mobile number › Add**. **Expect:** a passkey prompt if you have one, then an SMS code; entering it shows "Codes go to the number ending …". An email tells you the number was set.
- [ ] Set *Passkey approval threshold* low (Settings › Agency) and send something for approval. In a **private window** (as on a public computer), sign in with an email code and approve it in My work. **Expect:** the dialog offers *Use passkey*, *Text me a code*, and the tip about your phone's QR code.
- [ ] **Text me a code**, then enter it. **Expect:** approved; an email and a notice that you confirmed by SMS code; the administrator gets a notice; Audit shows the *FLAGGED* entry.
- [ ] Within 5 minutes, change a trust account. **Expect:** it asks for your passkey: "a code by SMS confirms approvals only".
- [ ] **Use passkey › Use a phone or tablet** on a computer with Bluetooth. **Expect:** a QR code; scanning it with your phone confirms.

## 9. Notices (UTC fix)

- [ ] Publish a notice with an end date. **Expect:** it publishes (this failed before 20 October) and shows in the resident portal until the end date.

## 10. The demo agencies, and a passkey for each person

Sections 11 to 16 use the development seed instead of a hand-made agency.

1. With the services and the API running (section 0), load the demo agencies once (running it again changes nothing):
   ```bash
   dotnet run --project backend/src/Humo.Api -- seed-demo
   ```
2. Sign in by email link (Mailpit) as:
   - `thandeka@acacia.example`: Agency Administrator;
   - `priya@acacia.example`: Finance;
   - `johan@acacia.example`: Portfolio Manager, Kingfisher Court only;
   - `anele@mail.example`: an owner;
   - `annette@fynbos.example`: Fynbos's administrator (Essentials).
3. **Add a passkey for Thandeka and for Priya** (Settings › Security › *Add a passkey*; Windows Hello works on localhost). Bank details, trust accounts, releasing payments and recording a budget's approval all need one, and an SMS code isn't accepted for them.
4. **Two people at once:** sign Thandeka in in a normal window and Priya in a private window (or another browser). Maker and checker needs both.

- [ ] **A form that needs a passkey you don't have** (fixed 31 October 2026): as someone without one, Settings › Agency › Trust accounts › *Change* › *Change account*. **Expect:** the dialog says you have no passkey; *Set up a passkey* opens Security with the form closed, so *Add a passkey* is in view.

## 11. Trust accounts

- [ ] As Thandeka: Settings › Agency › Trust accounts. **Expect:** every scheme has a row (Scheme, Bank, Account number, Status), readable side by side.
- [ ] *Change* a scheme's account (bank, 6-digit branch code, 7 to 12-digit account number), confirm with your passkey. **Expect:** saved; the status is *Awaiting bank letter*; the change is in the audit log as a security event.

## 12. Supplier payments (D27)

- [ ] As Priya: Finance › Payables › *Ready to pay*: select **SafeGuard Security**'s invoice and *Create payment batch*. **Expect:** refused: its bank details aren't verified.
- [ ] As Priya: My work › Approvals › *Verify bank details — SafeGuard Security* (Thandeka entered them). **Expect:** the call-back instructions; approving asks for the passkey; SafeGuard's supplier page then says verified.
- [ ] As Priya: select AquaFix's and GreenLeaf's Kingfisher Court invoices and create a batch. **Expect:** batch PB-KC-0001 with the verified accounts it will pay; for Priya it says someone else approves it.
- [ ] As Thandeka: approve it (on Payables or in My work), then *Release and download the payment file* with the passkey. **Expect:** a CSV downloads (beneficiary, bank, branch code, account number, amount, references); the invoices move to *Paid*; Mailpit has a remittance advice for each supplier.
- [ ] Make another batch, then change a supplier's bank details (Suppliers › the supplier › *Change bank details*) and verify them as the other person. **Expect:** releasing the batch is refused ("Bank details changed after this batch was made"); *Cancel batch* frees its invoices.

## 13. Staff

- [ ] As Thandeka: Portfolio › Staff. **Expect:** Thandeka, Priya and Johan with their schemes, open tasks and approvals waiting.
- [ ] Open Priya: *Set away cover*, covered by Johan, from today. **Expect:** Priya's open tasks and messages move to Johan; approvals stay. Johan's row says he's covering.
- [ ] *Priya is back*. **Expect:** what’s still open moves back to Priya.

## 14. Budgets (D28)

- [ ] As Priya: Finance › Budgets › *New budget* › Kingfisher Court, **This year's**. **Expect:** it asks for the financial year end (February unless it's set) and opens a draft for the current year, with lines from the levy roll.
- [ ] *Spending before Humo PM*: a date last month and a few amounts. **Expect:** actuals include them; the bars and the variances update.
- [ ] *Record the owners' approval*: the AGM's date and resolution, with the passkey. **Expect:** approved; *Add a line* and *Edit* are gone; the audit log has it as a security event.
- [ ] *New budget* › **Next year's** at 7%. **Expect:** every line about 7% up (rounded to R100); *Record the owners' approval* is the main button (meetings aren't on the live system yet).
- [ ] Settings › Levies & billing › Financial years: change Kingfisher Court's year end. **Expect:** saved.

## 15. Reports and scheme health

- [ ] As Thandeka: Reports. **Expect:** eleven reports; no resolutions register or compliance status yet.
- [ ] Open *Age analysis*, *Debtors list* and *Scheme health*. **Expect:** figures that match the accounts (Lindiwe and Grace in arrears on Kingfisher Court); a totals row; *Export CSV* works.
- [ ] Dashboard and Schemes. **Expect:** collection rate, arrears and the health rating agree with the *Scheme health* report (before 30 October every scheme read 100% collected).
- [ ] As Annette (Essentials): Reports. **Expect:** no billing summary, receipts, supplier payments or debtors list (they need Professional).

## 16. The screen check (runs in CI on every pull request)

It signs in as each demo person and opens every page in their menu; any error fails it. To run it yourself, with the seeded API, Mailpit and `npm run start:api` running:
```bash
npm --prefix frontend/humo-web run e2e:screens
```
- [ ] **Expect:** six tests pass in a few minutes. A failure names the page and the error; the report is in `frontend/playwright-report`.

## 17. Meetings and resolutions (Governance, Enterprise)

1. Governance is in Enterprise: as `terry@humo.co.za`, Platform › Customers › Acacia › *Manage features* › package **Enterprise** (passkey).
2. As Thandeka: Governance › Trustee boards › Kingfisher Court › *Invite to Humo PM* for Sipho; open the invite from Mailpit in a private window and add a passkey. Written resolutions are decided by a trustee.

- [ ] Meetings › *Schedule*: Kingfisher Court, trustee meeting, 3 days ahead; *Send notice*. **Expect:** refused, 7 days' notice needed.
- [ ] *Reschedule* to 10 days ahead, *Send notice*. **Expect:** Mailpit has a notice for each of the three trustees (date, venue, agenda); adding an agenda item is now refused.
- [ ] *Record attendance* with one trustee present. **Expect:** "Not quorate". With two: held.
- [ ] *Add a resolution* passed 2–0–0 with an action for Priya. **Expect:** the action is in Priya's Tasks; when she completes it, Resolutions shows *Completed*.
- [ ] *Send minutes for approval*; approve them in My work (Sipho or Thandeka). **Expect:** *Minutes approved*.
- [ ] Resolutions › *Propose* a written resolution with an action. **Expect:** no task yet; when Sipho approves it in My work it's *Passed* and the action appears in Tasks.
- [ ] Schedule an **AGM** 20 days ahead; Finance › Budgets › next year's draft › *Put it to the AGM*. **Expect:** it uses the AGM's *Budget and levies* item. *Send notice*: every owner gets it (with the proxy line). Record attendance (owners present: 2 or more), then a passed resolution on that item. **Expect:** the budget is *Approved*, citing the resolution.
- [ ] Trustee boards › *Appoint* as elected. **Expect:** the *Resolution* list holds passed resolutions only.
- [ ] Reports. **Expect:** the *Resolutions register* is there.
- [ ] As Annette (Fynbos, Essentials). **Expect:** Governance shows *Trustee boards* only (D29); budgets keep *Record the owners' approval*.

## 19. What each package adds (D29)

- [ ] Sign in as `annette@fynbos.example` (Fynbos, Essentials). **Expect:** the Governance menu has *Trustee boards* and nothing else. `/governance` opens Trustee boards; `/governance/meetings` says it isn't on your plan.
- [ ] Trustee boards › Protea Gardens › *Add a trustee*: Fatima Isaacs, Chairperson, *Elected by the owners*. **Expect:** the Resolution field is a text box. Type "AGM 12 March 2026, resolution 4" and save. **Expect:** she's on the board with that reference.
- [ ] *Invite to Humo PM* on her row. **Expect:** Mailpit has the invitation.
- [ ] As a Professional agency admin without Meetings & AGMs: Governance. **Expect:** *Trustee boards* and *Scheme rules*; no Meetings or Resolutions.
- [ ] Prototype (`npm start`), as Thandeka after removing Acacia's add-on (as `terry@humo.co.za`: Platform › Customers › Acacia › *Manage features*): Scheme rules › a rule › *Amend*. **Expect:** the Resolution is a text box with a *Passed on* date; the new wording shows that reference.
- [ ] As `terry@humo.co.za`: Platform › Pricing & add-ons. **Expect:** the add-on is called *Meetings & AGMs*; no package lists *Advanced permissions*.
- [ ] As Thandeka (Acacia, Enterprise): *Add a trustee* › *Elected*. **Expect:** the Resolution is still chosen from the scheme's passed resolutions.

## Reporting back

For each box that didn't match **Expect**, note the section, what you did, what happened, and a screenshot if it helps. Claude fixes them on a branch, with a test for each.
