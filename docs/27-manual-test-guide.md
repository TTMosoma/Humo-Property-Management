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
- [ ] **Your first passkey** (D30): as someone without one (e.g. `annette@fynbos.example`, signed in by email link), Settings › Security › *Add a passkey*. **Expect:** the explanation of why Humo is careful, and four choices. Choose *This device*. **Expect:** Windows Hello asks straight away, with no "Additional verification" dialog. The passkey is listed as *This device*, the audit log has *Added a passkey (This device)*, and Mailpit has "A passkey was added to your Humo account".
- [ ] **Another passkey needs the first** (D30): as Thandeka, *Add a passkey* › *Phone or tablet*. **Expect:** it asks you to confirm with your passkey, then *Confirmed. Now create the new passkey*. *Create the passkey* opens the QR code prompt.
- [ ] **An email link isn't enough** (D30): as Thandeka, signed in by email link, *Add a passkey* › any option, then *Cancel* the confirmation. **Expect:** a red message stays on screen, "We couldn't confirm it's you", until you dismiss it, and nothing is added.
- [ ] **A failure stays on screen** (D30): *Add a passkey* › *This device*, then close the Windows Hello prompt. **Expect:** a red message, "The passkey wasn't created", that doesn't disappear.
- [ ] **The same at sign-in** (D30): in a private window, sign in as someone with no passkey by email link and answer *Yes, it's mine*. **Expect:** the explanation, four choices and *Not now*.
- [ ] **Not on a shared computer** (D30): in a new private window, sign in by email link and answer *No, it's shared*. **Expect:** straight into Humo PM, with no passkey screen. In that same window, sign out and sign in by email link again. **Expect:** no question and no passkey screen.
- [ ] **The password manager note** (D30): Settings › Security › *Add a passkey*. **Expect:** under the four choices, a note says that if Windows Hello or another prompt appears instead of your password manager, your password manager isn't handling this site, and to check its settings or close the prompt.
- [ ] **Removing a passkey** (D30): remove one of two passkeys. **Expect:** Mailpit has "A passkey was removed from your Humo account".

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

## 18. Times on a history, and who was told after a cooling-off

- [ ] As Priya (Finance): Finance › Receipts, capture a payment dated today and allocate it to Kingfisher Court unit 42. Open the unit's *History*. **Expect:** "Payment received" shows the time you allocated it, not 08:00.
- [ ] Capture one dated five days ago and allocate it. **Expect:** it sits on that date with no time, and the detail says when it was put on the account.
- [ ] On the same history, "… became the owner". **Expect:** a date, no time.
- [ ] Let an approval made alone take effect after its cooling-off (§ approvals, D24) on a scheme with trustees on record. **Expect:** the approver's notice and the audit entry say "Trustees told:" with each name and how (email address or mobile).
- [ ] The same on a scheme with no trustees on record (e.g. Flamingo Pointe). **Expect:** "… has no trustees on record, so no trustee was told. Tell the trustees yourself."

## 20. Scheme rules and the breach log on the API (D29)

Restart the API, then load the demo rules once: `dotnet run --project backend/src/Humo.Api -- seed-demo`. It says "Acacia: scheme rules added to 2 schemes".

- [ ] As Thandeka: Governance › Scheme rules. **Expect:** the register, not *Coming to Humo Property Management*: Pets, Parking and so on, each "Adopted 01 Jun 2019 · Registered rules". Reload. **Expect:** still there.
- [ ] *Amend* a rule and change its wording. Leave the Resolution on *Choose the resolution* and save. **Expect:** "Resolution is needed." The demo data has no passed resolutions, and the list says so.
- [ ] Choose *Not in the register: type it from the minutes*. **Expect:** *As in the minutes* and *Passed on* appear. Type `AGM 12 March 2026, special resolution 2`, choose a date in the future and save. **Expect:** refused, not in the future. Choose a past date and save. **Expect:** the new wording shows with that reference, and *1 earlier version* opens the old wording.
- [ ] To choose from the register, first create a passed resolution: Governance › Meetings › *Schedule* Kingfisher Court, trustee meeting, 10 days ahead; *Send notice*; *Record attendance* with two trustees; *Record a resolution* passed 2–0–0. Go to Scheme rules, which opens on the first scheme, and *Amend* a Die Eike rule. **Expect:** the resolution isn't in the list, because it belongs to Kingfisher Court. Set *Scheme* to Kingfisher Court and *Amend* a rule. **Expect:** that resolution is in the list, as `RES-KC-…` and its title. Choose it and save. **Expect:** the new wording cites it.
- [ ] *Repeal* a rule with no open breaches, choosing *Not in the register*. **Expect:** it stays in the register as repealed, with that reference.
- [ ] Without Meetings & AGMs (as `terry@humo.co.za`: Platform › Customers › Acacia › *Manage features* › package **Professional**, add-on off; set it back to **Enterprise** afterwards): *Amend* a rule. **Expect:** no list, just a text box with *Passed on*.
- [ ] *Add a rule* with no resolution. **Expect:** it says "Captured from the registered rules by" you. Add another with the same number. **Expect:** refused: amend it instead.
- [ ] *Share with owners*. **Expect:** after a few seconds, "Owners and residents have the rule book"; *open it* shows a PDF of the rules in force. Amend a rule the same way with today's date. **Expect:** the page says the rules have changed since the copy was shared.
- [ ] *Upload rules PDF*, shared with owners, with *Registered with the CSOS*. **Expect:** it's listed under *Registered rules*, and Documents has it under Rules with the rule book archived. Upload a second, staff-only. **Expect:** the first is listed as an earlier version and owners keep it.
- [ ] Breach log: *Log a breach* on Unit 42, against the owner. **Expect:** it opens as *Reported*, nothing is sent, and the page says who it's with (the scheme's portfolio manager).
- [ ] *Send a warning* by email, 14 days. **Expect:** Mailpit has the letter with "Please put this right by" and the date above *Kind regards*; the history links to it in Communications › Sent; Tasks has "Check whether Unit 42 has put right", due on that date.
- [ ] Log a breach and try to send a final warning first. **Expect:** *Send a warning* is the only letter offered.
- [ ] From *Warning sent*: *Send a final warning*, then *Refer to the trustees*. **Expect:** the check task closes and a "Decide on breach" task appears; trustees with a sign-in get a notification and an email. *Send a final warning* is gone.
- [ ] *Record the outcome*. **Expect:** *Resolved*, and the "Decide on breach" task is done. *Reopen* with a note. **Expect:** *Reported* again.
- [ ] *Repeal* a rule with an open breach. **Expect:** refused: resolve the open breaches first. Resolve them and repeal it. **Expect:** it stays in the register, marked repealed.
- [ ] As Priya (Finance): `/governance/rules`. **Expect:** you don't have access (D32, see §22).
- [ ] As Annette (Fynbos, Essentials): `/governance/rules`. **Expect:** it says it isn't on your plan. In the browser console, `await (await fetch('/api/breaches')).json()`. **Expect:** `not-entitled`.

## 21. Trustee access follows the board, and lists show what's chosen

Restart the API first.

- [ ] Wait a minute after the restart, then sign in as `johanna@mail.example` (owner of Die Eike unit 9, on its board, invited earlier as an owner only). **Expect:** the role switcher offers Owner and Trustee, and *Trustee* opens the trustee view of Die Eike.
- [ ] As Thandeka: Portfolio › People › Johanna Visser. **Expect:** the header says "Trustee of Die Eike", naming the scheme rather than a count.
- [ ] Add a new owner at Kingfisher Court; *Appoint* them to its board; then *Invite* them from their People record as an owner. Open the invitation from Mailpit in a private window. **Expect:** the role switcher offers both Owner and Trustee.
- [ ] Governance › Scheme rules › Breach log › *Log a breach*. **Expect:** Rule and Unit start on *Choose…*. Save without choosing. **Expect:** "Rule is needed." Choose the first rule in the list. **Expect:** it's accepted, with no need to pick another one first.
- [ ] Maintenance › a newly reported job. **Expect:** Priority and Trade show the job's own values; if the scheme has no portfolio manager, *Assigned to* starts on *Choose…*.
- [ ] Any form with a list set in advance, e.g. People › *Add an owner or tenant*. **Expect:** the preset Scheme shows, with no *Choose…*. Role offers Owner and Tenant only, and its help says trustees are appointed on the board.
- [ ] Maintenance › *Log a request* › *Take or add a photo*, and pick a picture. **Expect:** the page stays put, the photo appears in the list, and the top bar stays visible.
- [ ] In one tab, sign in as Johanna, sign out, then sign in as Thandeka with a passkey, without reloading the page. Open Schemes, then *Log a request*. **Expect:** every Acacia scheme is listed in both, with no "We couldn't load your schemes".

## 22. What Finance can read, and the Staff lock (D32)

Restart the API first, so the migration runs.

- [ ] Sign in as `annette@fynbos.example` (Essentials): Portfolio › Staff, which shows a lock. **Expect:** it says Team management isn't on your plan, with no list of staff. In the browser console, `await (await fetch('/api/staff')).json()`. **Expect:** `not-entitled`.
- [ ] Sign in as `priya@acacia.example` (Finance). **Expect:** the menu has *Suppliers* and *Resolutions*, with no Maintenance jobs, Meetings, Trustee boards, Scheme rules or Compliance. On Professional, *Resolutions* shows a lock.
- [ ] As Priya: Tasks, then the *Team* tab. **Expect:** no "Check whether Unit … has put right" and no maintenance tasks. Approvals has *Verify bank details* for SafeGuard Security.
- [ ] As Priya: in the browser console, `(await (await fetch('/api/work-items')).json()).map(w => w.type)`. **Expect:** no `rule-breach`, `follow-up` or `maintenance-triage`.
- [ ] As Priya: open `/governance/rules`, `/governance/meetings` and `/maintenance` by typing the address. **Expect:** each says you don't have access.
- [ ] As Priya: Finance › Payables, and open the job reference on an invoice that has one. **Expect:** the job opens, with no buttons to change it.
- [ ] As Priya: open a scheme. **Expect:** no Maintenance, Meetings or Compliance tabs, and no *Open jobs* or *Next meeting* figures. The *+ New* menu has no *Log maintenance request*.
- [ ] As Priya: Communications › Sent, with Kingfisher Court chosen. **Expect:** no warning letters, though Thandeka sees them there.
- [ ] As Thandeka: Tasks › *Team* › a "Check whether…" task › *Assign…*. **Expect:** Johan and you are offered, not Priya. Choose Johan. **Expect:** it moves to him. In the browser console, `await (await fetch('/api/work-items/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['<the task id>'], assigneeId: '<Priya’s id>' }) })).json()`. **Expect:** refused: it can only go to someone who enforces the rules.
- [ ] As Thandeka: Tasks › *Team* › an ordinary task › *Assign…*, and tick a task to use the bar's *Assign to…*. **Expect:** both list every staff member, including Priya, and the *Assignee* filter lists them too.
- [ ] As Thandeka: Inbox › a conversation, and Maintenance › a new job. **Expect:** the assignee lists show your staff, and choosing one works.
- [ ] As Thandeka: Portfolio › Staff › Johan, and set Priya as his cover from today. **Expect:** his ordinary tasks move to Priya and his "Check whether…" tasks move to you. End the cover. **Expect:** they all go back to Johan.
- [ ] As Johan: Tasks and Governance. **Expect:** everything as before, including *Log a breach* and the "Check whether…" tasks.

## 23. Editing a person, and someone with no property left (D33)

Restart the API first. Use a test owner who has signed in (Add an owner at Kingfisher Court and *Invite* them, or use Johanna), and keep a private window signed in as them.

- [ ] As Thandeka: People › the owner › *Edit contact details*: change the surname and mobile, and save. **Expect:** the page shows the new details, and the owner can still sign in and sees their unit.
- [ ] Open that person's page in two tabs, save an edit in one, then save a different edit in the other. **Expect:** the second is refused because someone else changed it.
- [ ] As Thandeka: on someone who is both owner and trustee, Governance › Trustee boards › end their term today. **Expect:** after a reload, the role switcher no longer offers Trustee, and *Owner* still works.
- [ ] Record a sale of the same person's unit (add the buyer with *They replace the owner*), dated next week. **Expect:** nothing changes for them yet. (Ending their ownership with nobody after them is refused, D36.)
- [ ] Record the sale dated today or earlier instead, then reload as them. **Expect:** they stay signed in, on "You don't have any property registered under your name at the moment", with the agency's contact details and what they used to hold.
- [ ] As them: the menu. **Expect:** Home and their profile and security only. Open `/my/account` by typing it. **Expect:** you don't have access, with a way home.
- [ ] As a former owner who had a statement issued while they held the account. **Expect:** it's listed under *Your past statements*, and its PDF opens. The new owner's statement isn't listed.
- [ ] Sign them out and back in. **Expect:** they land on the same page, not the sign-in page.
- [ ] As Thandeka: add them as an owner again. **Expect:** after a reload they land on the owner's home, and the role switcher also offers *Former resident*.
- [ ] As Thandeka: Settings › Users & access › that person. **Expect:** *Former resident* shows and can be ended, and isn't offered when adding a role. End it on someone with nothing else. **Expect:** they can no longer get in.
- [ ] As Thandeka: record a sale on a unit whose owner is signed in, using *They replace the owner*, with a date that's already passed. **Expect:** the seller's next reload shows the new page straight away.

## 24. Changing someone's email (D34)

Restart the API first. Check Mailpit (localhost:8025) for each email.

- [ ] Sign in as `marike@mail.example`. **Expect:** her *Former resident* page ("You don't have any property registered under your name at the moment"), not a spinner.
- [ ] As Thandeka: Settings › Users & access. **Expect:** *Two email addresses on record* lists Nadia Abdul with her contact and sign-in addresses. Choose *Use nadia@absa.example*. **Expect:** she leaves the list, and her People record shows that address.
- [ ] As Thandeka: People › Nadia Abdul › *Edit details*. **Expect:** the Email field explains that the new address has to confirm. Change it to a new address and save. **Expect:** a toast says it needs confirming, a banner on her page says who it's waiting for, and her email hasn't changed.
- [ ] Mailpit. **Expect:** the new address has a confirmation link, and the old one has "A change of email was requested", naming the new address.
- [ ] As Thandeka: Settings › Audit log. **Expect:** "Updated contact details for Nadia Abdul: email … to … (waiting for them to confirm)".
- [ ] Before confirming, send her a statement or sign in as her with an email link. **Expect:** it goes to the old address.
- [ ] Open the link from the new address in a private window and choose *Confirm*. **Expect:** it says the email is changed; People shows the new address; the old address is told; a sign-in link now goes to the new address; the audit log has "Confirmed the change of email from … to …".
- [ ] Open the same link again. **Expect:** refused: it was used already.
- [ ] Change her email again, then *Cancel the change* on her page. **Expect:** the banner goes, and the link is refused.
- [ ] Change her email to `thandeka@acacia.example`. **Expect:** refused: someone else signs in with it.
- [ ] As Thandeka: People › an owner who hasn't signed in › change their email. **Expect:** it changes straight away, no email is sent, and the audit log has the old and new address.
- [ ] As Thandeka: Settings › Users & access › Johan › edit his email. **Expect:** it asks for your passkey, then waits for confirmation, and is listed under *Waiting for a new email to be confirmed*. Cancel it there.

## 25. When a unit changes hands (D35)

Restart the API first, so the migration runs, and wait a minute.

- [ ] As Thandeka: Die Eike › Unit 3 › account. **Expect:** the account is held by Marike du Toit until Joseph Jackson's ownership starts on 20 November.
- [ ] Sign in as `joseph@mail.example`. **Expect:** no owner role for unit 3 yet (he's still a trustee). After 20 November, *My account* starts with "Balance when you took over" and shows no August to October months.
- [ ] Sign in as `marike@mail.example`. **Expect:** *Your past statements* lists September and October 2026 for Unit 3, marked "not sent at the time". Open September's PDF. **Expect:** it's addressed to her.
- [ ] As Thandeka: send the September statement for DE-003. **Expect:** Mailpit has it for Marike, not Joseph.
- [ ] As Thandeka: on another unit with an owner who signs in, record a sale with *They replace the owner*, dated next week. **Expect:** the seller keeps access and the account; the buyer has neither until that day.
- [ ] Record a sale dated last week instead. **Expect:** the account moves to the buyer, and the buyer's account starts with "Balance when you took over".
- [ ] Portfolio › Units. **Expect:** *Units with no owner on record* lists Die Eike, Unit 3, "No owner on record from 5 Oct 2026 to 19 Nov 2026"; the unit's page says the same.
- [ ] People › Marike du Toit › her ownership of unit 3 › correct the last day to 19 November 2026 (or Joseph's first day to 5 October). **Expect:** the warning goes, and the account and access follow the new dates straight away.
- [ ] People › the only owner of a unit › *End*. **Expect:** refused, saying to add the buyer with *They replace the owner*.
- [ ] People › Joseph Jackson › *Add a role* › owner of Die Eike unit 3 again. **Expect:** refused: he already owns it.
- [ ] On a unit whose owner's ownership has ended with nobody after them, add an owner starting a week later than the day after. **Expect:** refused, giving the day after as the new owner's first day.
- [ ] People › someone with a sign-in. **Expect:** *Humo sign-in* says "Signs in", or "Invited, not accepted yet" before they accept.

## 26. Maintenance photos (D37)

Restart the API first. Have a JPEG on hand, and an iPhone HEIC if you can.

- [ ] As Thandeka: Settings › Plan & features. Note the storage used.
- [ ] Maintenance › *Log a request*: pick two photos. **Expect:** both show as previews; *Remove* takes one away. Log it. **Expect:** the job page shows the photo as an image, marked *Before*; opening it shows it full size.
- [ ] Settings › Plan & features. **Expect:** storage used has gone up by the photo's size.
- [ ] On the job: *Add photos* with a PDF renamed to `.jpg`. **Expect:** the red banner says "The photo wasn’t stored. Only JPEG, PNG or WebP photos can be uploaded." (no mention of highlighted fields). With an HEIC. **Expect:** refused, with the iPhone hint.
- [ ] Watch the red banner. **Expect:** it shows "Closes in Ns" counting down with a bar shrinking along its bottom, and closes by itself. Do it again and rest the pointer on it. **Expect:** "Paused while you read", and it stays. Move off. **Expect:** the countdown carries on. Do it again and press the **×**. **Expect:** it closes at once.
- [ ] On a job that needs triage, change *Trade* without saving. **Expect:** *Ask for quotes* lists that trade's suppliers for the scheme at once, ticks the first vetted ones, and the button reads "Save & request N quotes". A trade with no supplier says so, and the button reads *Save triage*.
- [ ] On a job with a photo, press the **×** on the photo. **Expect:** "Remove this photo?" asks first. Remove it. **Expect:** the photo goes, the job's activity says "Removed a photo…", and Settings › Plan & features shows storage used down by its size.
- [ ] Take a job to *Completed*, then *Add photos*. **Expect:** the photo is marked *After*, and completing the job added no "Completed work" placeholder.
- [ ] As `sipho@mail.example` (owner): *Report a problem* with a photo. **Expect:** the request is sent, and Thandeka sees the photo on the job.
- [ ] As Priya (Finance), open a job from its invoice. **Expect:** its photos show.

## 27. A supplier's vetting documents

Restart the API first. Have a PDF on hand.

- [ ] As Thandeka: Maintenance › Suppliers › AquaFix Plumbing. **Expect:** it shows *Document missing*, not *Vetted*, and the five vetting documents are listed as *Not on file*, each with *Upload* and no *Request*.
- [ ] Press *Upload* on *Public liability insurance* and leave *Expires* empty. **Expect:** it asks for the date.
- [ ] Upload a PDF for COIDA, public liability and tax, each with a date next year. **Expect:** each shows *Valid*, and AquaFix still shows *Document missing* until the bank letter is on file too. Upload the bank letter, which needs no date. **Expect:** *Vetted*.
- [ ] In *Documents on file*, open one of those documents and try to archive it, or change its date. **Expect:** refused: upload the new one instead.
- [ ] As Priya (Finance): open the supplier. **Expect:** no *Upload* on the vetting documents.
- [ ] On a job booked with a supplier that has a document missing. **Expect:** the work order lists what's missing, and can't be issued without ticking *Proceed anyway*.

## 28. Tasks that close themselves

- [ ] As Thandeka: Tasks › a debtor follow-up, such as "send a final demand". **Expect:** the button is *Open debtor case*, with no *Mark done*. The drawer says the task closes itself, and no longer mentions a "workflow slice".
- [ ] Press *Open debtor case* and send the final demand. **Expect:** the task has gone from Tasks, and the next follow-up has been created.
- [ ] Tasks › a new maintenance request. **Expect:** *Open the job*, with no *Mark done*. Save triage on the job. **Expect:** the task closes.
- [ ] Tick two tasks where one is a debtor follow-up. **Expect:** the bar at the bottom has no *Mark done*.
- [ ] Tasks › a plain follow-up from Inbox, or a meeting action. **Expect:** *Mark done* is still there and works.

## 29. Technical logs

Restart the API first. You'll need the System Administrator sign-in.

- [ ] As the System Administrator: Platform › Technical logs. **Expect:** today's entries, newest first, and clicking one shows its raw detail.
- [ ] In another window, as Thandeka, upload a PDF renamed from a text file on a supplier. Back in the log, set *Warnings and errors* and search `Only PDF`. **Expect:** the refused request, with the reason under it.
- [ ] Pick a day with no activity. **Expect:** "Nothing for that day and search."
- [ ] Press *Download this day*. **Expect:** it asks for your passkey, then downloads a `.json` file.
- [ ] Platform › Audit log. **Expect:** "Read the technical log for…" and "Downloaded the technical log for…".
- [ ] As a Humo Support user, or as Thandeka. **Expect:** no *Technical logs* menu, and `/platform/logs` is refused.

## 30. Spending above the limit is the board's (D39)

Restart the API first. You'll need a PDF, and Thandeka's and Sipho's sign-ins. Kingfisher Court's board register decides how many must approve: check it in Governance › Board.

- [ ] As Thandeka: Settings › Agency › *Agency can approve up to*. **Expect:** R5 000 for each scheme. Change Kingfisher Court's to R6 000. **Expect:** it asks for your passkey, then shows R6 000.
- [ ] On a Kingfisher Court job, record a quote of R5 500 and approve it. **Expect:** *Approve R5 500 (within the R6 000 limit)*. Put the limit back to R5 000.
- [ ] On another job, record a quote of R8 000. **Expect:** no *Approve* button; *Send R8 000 to the board*. Send it.
- [ ] In Approvals, as Thandeka. **Expect:** "The board decides: 0 of N approvals needed", the trustees listed, and no *Approve*: only *Record the board’s signed approval*.
- [ ] As Sipho (trustee): approve it. **Expect:** if the board has more than one trustee, it stays open with 1 approval, and Sipho sees "You’ve decided".
- [ ] As Thandeka: *Record the board’s signed approval*, choose another trustee, today's date, a PDF. **Expect:** passkey, then the job is approved once a majority is reached. Mailpit: every trustee with an email got "Board approval recorded", naming who signed.
- [ ] Try again on a new item with a *Signed on* date before it was sent. **Expect:** refused: signed before it was sent to the board.
- [ ] On a job marked *High* with a quote above the limit. **Expect:** no *Emergency* button. Press *Change priority…*, choose *Urgent* with a reason. **Expect:** the job's history says "Priority changed from high to urgent" with the reason, and *Emergency: go ahead now…* appears.
- [ ] On an urgent job with a quote above the limit: *Emergency: go ahead now…* with a reason. **Expect:** passkey, the job is approved with "Went ahead in an emergency… The board to confirm", and the trustees are emailed.
- [ ] Take that job to an approved invoice, then try to add it to a payment batch. **Expect:** refused until the board confirms it in Approvals; then it can be paid.

## 31. Resolving a dispute and correcting an account (D40)

Restart the API first. You'll need Thandeka's and Priya's sign-ins, and a trustee's for the write-off.

- [ ] As Priya: Finance › Credit control › an account in arrears › *Owner disputes it*, with a reason. Then *Resolve dispute*. **Expect:** four choices: the charge stands, the owner paid, charged in error, the board waives it.
- [ ] Choose *Charged in error*, pick a levy line, the amount and a note. **Expect:** the case shows "Resolving: a reversal of R…, waiting for a second person", collection stays paused, and the balance hasn't changed.
- [ ] As Priya, in Approvals › *All pending*. **Expect:** no *Approve* on her reversal; it says Thandeka can approve it, and it isn't under *Waiting for me*. As Thandeka, approve it. **Expect:** the account shows "Reversal of Levy — …" and the dispute is resolved.
- [ ] Try to reverse the same charge again. **Expect:** refused: it's already been reversed.
- [ ] On another disputed account, choose *The board waives it* with an amount. **Expect:** Thandeka can't approve it; the card says "Waiting for the board", which trustees have been asked in My work and whose signed approval to collect. Sipho gets a bell notification and an email "For the board to decide". As a trustee, approve it. **Expect:** "Written off by the board — …" on the account.
- [ ] Choose *The owner paid* with no payment chosen. **Expect:** refused: choose a payment on the account.
- [ ] On an account page: *Journal adjustment* offers only a charge. *Correct the account…* sends a reversal or write-off for approval.

## 32. Correcting a quote, and new quotes after a rejection (D41)

Restart the API first. You'll need Thandeka's and Sipho's sign-ins, and another agency approver (Johan, the Kingfisher Court portfolio manager) for the last step.

- [ ] On a Kingfisher Court job, record a quote of R10 000. **Expect:** *Next step* no longer has a field to record that quote; the quotes table offers *Correct…* and *Ask for a revision…*. (A revision lets you record it again; if the supplier keeps the price, it shows "revised: same price".)
- [ ] *Correct…* to R1 000 with the reason "Typing error". **Expect:** the table shows R1 000 with "was R10 000", and the job's history says "corrected: R10 000 → R1 000: Typing error (now within the scheme’s limit…)".
- [ ] As Thandeka, *Approve*. **Expect:** refused: you corrected it to within the limit. As Johan, approve it. **Expect:** approved.
- [ ] On another job, a quote of R9 000 sent to the board. As Sipho, reject it with a reason. **Expect:** the quote shows *Rejected* with the reason, and *Ask for a revision…*. Ask, then record R7 500. **Expect:** "Revised quote received", "was R9 000", and it can be sent to the board again.
- [ ] While it waits for the board, *Correct…* it. **Expect:** the approval is withdrawn (Approvals shows it *Withdrawn*), Sipho gets "Withdrawn: …", and the job is back to quotes.
- [ ] Once approved, *Correct…* to a lower price. **Expect:** it stays approved at the new amount. *Correct…* to a higher one. **Expect:** quotes reopen, to be approved again.
- [ ] Once the work order is issued. **Expect:** no *Correct…*.

## 33. Suppliers quote and take work orders by email (D38)

Restart the API first. Emails arrive in Mailpit (localhost:8025). Use a supplier whose email you can read there, such as AquaFix Plumbing, and a job with a photo.

- [ ] As Thandeka, on the job: *Ask for quotes* lists the job's photos under *Photos to send*. Untick one, tick AquaFix, and send. **Expect:** the job's history says "Quote request emailed to AquaFix Plumbing". *Request quotes through Humo Contractor* isn't offered.
- [ ] In Mailpit, open the email. **Expect:** the title, area and a link; no photos, no resident's name, no address.
- [ ] Open the link in a private window (not signed in). **Expect:** a Humo Contractor page with the work and the photos you left ticked; not the unticked one.
- [ ] Send a quote of R1 200 with a PDF. **Expect:** "Your quote has been sent" and the Humo Contractor promotion. On the job: received, R1 200, "Their quote (PDF)" opens.
- [ ] Send a revised quote of R1 100 from the same link. **Expect:** on the job, R1 100 with "was R1 200".
- [ ] Approve it. Open the link again. **Expect:** "Your quote has been decided", with nothing to send.
- [ ] Issue the work order. **Expect:** a "Work order" email; its page shows the address and the access notes. *Confirm this date*. **Expect:** the job says AquaFix confirmed the date.
- [ ] On another job, *Ask for a revision…* of a supplier's quote. **Expect:** a new email; the old link says it isn't valid, the new one opens.

## 34. The email address on the sign-in screens

- [ ] Sign out. Make the window narrow (about the width of a phone held sideways), enter `thandeka@acacia.example` and continue. **Expect:** on *Confirm it's you*, the address is whole on one line, with the full stop after it.
- [ ] Cancel and choose *Email me a sign-in link*. **Expect:** "If thandeka@acacia.example has a Humo account…" shows the address whole.
- [ ] On a phone (or the browser's phone view), sign in with a long address. **Expect:** it fits on the screen without scrolling sideways.

## 35. Version numbers

- [ ] Open the sign-in page. **Expect:** the footer ends "version 0.9.0".
- [ ] Sign in and open the account menu (your name, top right). **Expect:** "Humo Property Management · version 0.9.0" at the bottom, under *Sign out*.
- [ ] Restart the API and open `http://localhost:5080/api/health`. **Expect:** `{"status":"ok","version":"0.9.0"}`.
- [ ] Open CHANGELOG.md on GitHub. **Expect:** releases 0.1.0 to 0.9.0 with their dates, and an Unreleased section.

## 36. Problems you can't see come up as a toast

- [ ] As Thandeka, open *Communications › Compose*. Choose a scheme and Email, leave the subject empty, and write a message of a sentence. Make the browser window short (or zoom in) so the subject is out of view when you're at the *Send* button, then send. **Expect:** a red toast "Emails need a subject." with *Show*. *Show* scrolls to the subject.
- [ ] Make the window tall enough to see the subject and send again. **Expect:** the message under the subject, and no toast.
- [ ] Open a job whose supplier isn't vetted, with the red "isn't fully vetted" note below the fold. **Expect:** no toast just for opening the job.

## 37. Humo's logs together in the menu

- [ ] Sign in as a System Administrator. **Expect:** the menu ends with *Pricing & add-ons*, then *Audit log* and *Technical logs* together. (*Feature flags* and *Platform health* aren't on the live system yet; in the prototype they come just before the logs.)
- [ ] Sign in as Humo Support. **Expect:** *Audit log* last, with no *Technical logs* (Support can't read them).

## Reporting back

For each box that didn't match **Expect**, note the section, what you did, what happened, and a screenshot if it helps. Claude fixes them on a branch, with a test for each.
