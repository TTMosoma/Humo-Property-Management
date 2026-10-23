# 27 · Manual test guide

**Purpose:** the checks the product owner runs by hand against the local stack before a release. The automated tests cover the rules; this guide covers what only a person can judge: the screens, the emails and SMS, and whether it all makes sense. Tick each box, and note anything that differs from **Expect**.

**Last updated:** 22 October 2026 (slices 3a, secure statement links, D16–D22).

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
- [ ] Enter a **wrong** code. **Expect:** "That code isn’t right. 4 tries left."
- [ ] Enter the **right** code. **Expect:** the statement shows, and **Download PDF** saves it.
- [ ] **Sent shows it read:** Communications › Sent, the statement's delivery. **Expect:** *read*.
- [ ] **On a phone:** open the same link on your phone. **Expect:** readable without zooming sideways.

## 7. Notices (UTC fix)

- [ ] Publish a notice with an end date. **Expect:** it publishes (this failed before 20 October) and shows in the resident portal until the end date.

## Reporting back

For each box that didn't match **Expect**, note the section, what you did, what happened, and a screenshot if it helps. Claude fixes them on a branch, with a test for each.
