# 18 · Production readiness register

**Purpose:** the frontend is a working prototype. Some actions look and behave like the real thing in the demo but are simulated. Every one of them is listed here, so none of them reaches production still simulated.

**Started:** 10 October 2026 (branch `demo-ready`).

## How the register works

**Three things keep an item from being forgotten:**

1. **The port.** Every simulated action goes through a domain port (an abstract class in `domain/ports` or `domain/contractor`). The production HTTP adapter must implement every abstract method, or the build fails. So nothing can be "left as a toast": the backend has to provide an endpoint.
2. **A tag in the code.** Find every item with:
   ```bash
   grep -rn "docs/18" frontend/humo-web/src
   ```
   - `PRODUCTION:` on a port method says what the real implementation must do.
   - `SIMULATED (docs/18 R-n)` on the in-memory adapter says what the demo does instead.
3. **This register.** An item is closed only when the real implementation is live **and** its tags are removed.

**Rule for new work:** anything added to the prototype that simulates an outside effect (an email, an SMS, a payment, a file, a notification to another product) gets an entry here and the two tags.

## Open items

| # | Item | What the demo does | What production must do | Decisions | Where |
|---|---|---|---|---|---|
| R-1 | **Email a statement** ("Email to owner" on the statement; "Re-send" on the account) | Records the email in Communications › Sent, with a simulated delivery result. Nothing leaves the browser. | Send the **stored, issued PDF** as a secure portal link (or an attachment, per agency setting). Record it in Sent. Track delivery and whether the link was opened. Links expire and need sign-in. | D7, D9 | `AccountDataSource.sendStatement`; `InMemoryAccountDataSource.sendStatement` |
| R-2 | **"Preview" label on statements** | Every statement is rebuilt from today's ledger, holder and trust account, and labelled *Preview*. | Open the stored PDF that was issued. Corrections appear on the next statement. Then **remove the label**. | D7, D8 | `statement-page.html` (`rerender-note`) |
| R-3 | **Message a contractor about a quote** ("Message through Humo") | The message is kept on the quote request. The customer sees the thread. Nobody is notified, and no contractor sees it: Humo Contractor is a separate app without these screens yet (docs/20). | Store messages server-side. Notify the contractor (email and in Humo Contractor). Let the contractor reply. Keep contact details hidden until a quote is accepted. | Contractor network (P3-7) | `ContractorNetwork.message`; `InMemoryContractorNetwork.message` |
| R-4 | **Invite a business by email to quote** | The address is kept on the quote request, shown as *Invited by email*, and recorded in the quote lifecycle. No email is sent. | Email a sign-up link for Humo Contractor that opens this request. When the business joins, turn the email invite into a normal invitation for their new profile. Expire unused invites. | Contractor network (P3-7) | `NewQuoteRequest.inviteEmails`; `InMemoryContractorNetwork.createQuoteRequest` |
| R-5 | **Delivery results in Sent** (all messages, notices, letters, statements, reminders) | Delivered / read / bounced results are simulated, deterministically. | Real results from the email, SMS and WhatsApp providers (webhooks), shown in Sent. | D9 | `CommsStore` (`outcome()`) |
| R-7 | **Demo hosting settings** | `npm run build:demo` adds `robots.txt` (block everything), `noindex` headers and single-page-app rewrites from `deploy/demo/`. | Production gets its own hosting settings. **Never deploy the demo configuration as production**: search engines would be told to ignore it. | — | `frontend/humo-web/deploy/demo/`; `angular.json` `demo` configuration |
| R-8 | **Sign-in** (`/sign-in`, `/signed-out`, `/sign-in/link`) | Passkeys are simulated: entering an email "finds" that person's passkey after a short pause, and *Sign in with a passkey* signs in the last person who used this browser. Sign-in links aren't emailed; the *Prototype* box on the "Check your email" step opens the link instead. *Demo accounts* lists the personas. | The identity provider chosen under D5 performs the WebAuthn passkey ceremony and sends the one-time links (or codes). The page stays Humo's branded front door, either as the provider's hosted page styled to match this design or by calling its SDK. Rate-limit links. Keep the same answer for "no account" and "no passkey". Remove *Demo accounts* and the prototype box (they disappear with the mock data layer, R-6). | D5 | `SessionDataSource.signInWithPasskey`, `sendSignInLink`, `completeSignInLink`; `features/access/sign-in-page.*` |
| R-9 | **New customer accounts: approval, delegated activation, notices** | Requests, decisions, the policy and Humo-staff notices live in this browser (`AccountRequestStore`). Notices are in-app only, and no email is sent or claimed. Rules are enforced by the in-memory API. | Enforce every rule server-side (doc 21 §2–§5). Make submit and decide atomic. Store requests, decisions and policy durably. Deliver notices in-app and by email to System Administrators and submitters. Append-only audit. | D4, D5 | `AccountRequestDataSource`; `InMemoryAccountRequestDataSource`; `mock/db/account-request-store.ts` |
| R-10 | **Billing inputs: receipt capture and bank-statement import; meter readings; levy model** (doc 22, D13) | The CSV is read in the browser and by the in-memory API. Receipts, mappings, import batches, meter readings and water rates live in browser storage; the seeded meter history stands for onboarding imports. Feature flags only hide screens. | Upload the file to the API, parse it server-side with the same rules (`bank-statement.ts`), and store the file, batch, mapping and receipts. Enforce the duplicate key and the date rules in the database. Store meter readings per unit and month with their history; billing reads them for the period. Store each scheme’s levy method and every applied levy roll (budget, approver, effective period); billing reads the levy in force for the period. **Enforce the feature flag in the API too**, not only in the UI. | D7 | `ReceiptDataSource` capture/import; `MeterDataSource`; `mock/db/receipt-import-store.ts`, `mock/db/meter-store.ts` |
| R-11 | **Uploaded files** (documents, the registered rules PDF) | The file is opened through a browser object URL that lasts only for the session. After a reload the record remains but the file can’t be opened. | Store files in object storage, scanned for malware, with the document record; serve them through short-lived signed links checked against the reader’s access. Enforce the PDF type and size limit server-side. | D7 | `LibraryStore.upload` / `contentUrl`; `RulesStore.upload` |
| R-12 | **Commercial catalogue and agreements** (Pricing & add-ons; Customer › Billing & agreement) (doc 23) | The catalogue (versioned terms), each customer's agreement (dated lines, adjustments, history) and the commercial settings live in this browser (`CommercialStore`), seeded from `/demo-data/`. Base package prices are *awaiting configuration*; example prices are *proposed*. Rules are enforced by the in-memory API. | Persist the catalogue versions, agreements and settings. Port `chargesOn`, `checkAgreementChange`, `applyAgreementChange` and `previewAgreementChange` rule for rule (the specs are the specification). Enforce price protection, own-account changes (D11) and step-up server-side. Append-only agreement history. | D4, D11 | `CommercialDataSource`; `InMemoryCommercialDataSource`; `mock/db/commercial-store.ts`; `domain/models/commercial.ts` |
| R-13 | **Storage quotas** | Usage is a demo measurement plus files uploaded in this simulation. The simulated API refuses an upload over quota; the UI says *Not yet enforced by a server*. | A storage service measuring usage per organisation (documents, images, generated files; not backups or logs). **The API checks the quota before accepting an upload.** Threshold notifications; exceptions that expire; no automatic charges or upgrades. | — | `StorageMeter`; `storageSummary`; `InMemoryLibraryDataSource.upload` |
| R-14 | **Humo invoices, payments and tax** | Invoices are built in the browser and never sent. Payments are simulated: a simulated provider, a "Simulate provider confirmation" button and a manual bank-reconciliation step. VAT is off (not registered). | Choose the provider (Payfast, Peach Payments or another) behind `IPaymentProvider`: checkout and mandates, **verified server-to-server notifications** (signature, amount, idempotency by event id), reconciliation, failed-payment retries, overdue reminders. A billing run that issues invoices on the billing date. Configure VAT and tax-invoice numbering once decided (D10). **Remove the simulate buttons with the mock layer (R-6).** Never store card numbers or CVVs. | D10 | `PaymentGateway`; `SimulatedPaymentGateway`; `CommercialDataSource.issueInvoice`, `startCheckout`, `simulateProviderNotification`, `reconcileEft`, `invoices`, `invoice`; `PlanDataSource.invoices`, `invoice` (own organisation only) |

## Closed items

| # | Item | What the demo does | What production must do | Decisions | Where |
|---|---|---|---|---|---|
| R-6 | **Mock data and prototype controls ship in the build** (closed 14 Oct 2026: production builds use `provideHttpData()` only; CI fails if demo data reaches a production bundle; the demo build keeps the simulation on purpose) | The demo build contains the in-memory data, the persona switcher and the *Prototype* panel. Each visitor's data lives in their own browser. | A production build with HTTP adapters only and no prototype controls. | P1-2 | `app.config.ts`; `mock/provide-mock-data.ts` |


## Related

- [audit/frontend-remediation-plan.md](audit/frontend-remediation-plan.md): P0-4 and P0-9 (done on `demo-ready`) created R-1 to R-4.
- [17-decisions.md](17-decisions.md): D7 (issued statements are fixed) and D9 (statement delivery).
- [19-demo-deployment.md](19-demo-deployment.md): how the demo is built and hosted.
- [23-commercial-management.md](23-commercial-management.md): R-12 to R-14.
- [demo/demo-limitations.md](demo/demo-limitations.md): what to say, and not say, when presenting.
