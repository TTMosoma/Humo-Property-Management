# 23 — Commercial management: pricing, agreements, storage and billing

Status: **built in the frontend prototype (12 October 2026, branch `feature/commercial-management`)**.
- Prices, invoices and payments are simulated. No money moves, and no invoice is sent.
- Decisions marked ⚑ need business approval.

**On the API (commercial slice, step C1, 19 October 2026):** in `backend/`, with tests in `backend/tests` (`CommercialRulesTests`, `CommercialApiTests`).

| Part | API | Notes |
|---|---|---|
| Catalogue and settings (§2) | ✅ | Seeded once from `demo-data/commercial/catalogue.json`: no base prices, examples marked proposed. Versioned terms, step-up, audited. |
| Agreements, charges, preview, changes (§2–§4) | ✅ | `CommercialRules` ports `chargesOn`, `checkAgreementChange`, `applyAgreementChange`, `previewAgreementChange` and `buildInvoice` rule for rule. Own customers only for Account Managers (D11). |
| Subscriptions and entitlements | ✅ | A new account opens a 30-day trial of its package. `GET /me` carries the entitlements; the API refuses commands the plan doesn't include (`not-entitled`): today the trustee board (Governance) and adding schemes. Features and packages come from `contracts/entitlements.json`, shared with the frontend. |
| Customers list, Customer 360, Plan & features, upgrade requests | ✅ | Health uses only what the API measures (active users, sign-ins, payment); the other signals say *Not measured yet* and are left out of the score. |
| Storage quotas (§5) | Partly | Allowances are calculated; usage isn't measured until documents are stored by the API (R-13). |
| Invoices and payments (§6) | Not yet | Next: step C2 (R-14). Until then no invoice is issued, and the screens say so. |
| Opportunities, nudges, monthly history | Not yet | Need usage data (step C3). The business overview shows the current month only. |

**Related:**
- [04-platform-commercial.md](04-platform-commercial.md): entitlements, health, nudges.
- [17-decisions.md](17-decisions.md): D4 (fixed roles), D10 (numbering), D11 (Account Managers change subscriptions).
- [18-production-readiness-register.md](18-production-readiness-register.md): R-12 to R-14.
- [demo/](demo/demo-data-strategy.md): the canonical demo data.

---

## 1. What existed, and what changed

**What existed** (doc 04):

| Concept | Before | Now |
|---|---|---|
| **Packages** | `PACKAGES`: Essentials, Professional and Enterprise, with features only. No prices. | **Unchanged.** Names and features stay there. Their commercial terms (price, storage, portfolio rule, versions) are in the commercial catalogue, keyed by the same package id. **No new or renamed tiers.** |
| **Add-ons** | `ADD_ONS` constants. Adding one meant changing code. | **Catalogue data** (`CommercialAddOn`). A new add-on needs no code change, only features the app already knows. The old single *Additional Storage* add-on is retired and replaced by 10, 50 and 100 GB packs. |
| **Subscription** | Package, add-ons and overrides, plus `mrr`: a recorded figure, not a calculation. | **Overrides** (trials, goodwill) stay on the subscription. **Package and add-ons in force** come from the customer's agreement on today's date. **MRR** is the agreement's recurring total. |
| **Account manager** | A display name stored on each customer, next to the id. | **Only the staff id is stored.** The name is looked up live from the Humo team record. |
| **Billing** | None ("Backend-only (later)" in doc 04 §8). | Agreements, invoices, payments, billing preference and tax configuration (below). |

**Entitlements are unchanged:**
- `resolveEntitlements()` is still the single engine.
- It now takes the published add-on catalogue, so catalogue-defined add-ons switch features on too.
- The app still only asks whether a feature is on.

## 2. The model: catalogue, agreement, invoice

```
Catalogue (effective-dated terms) → Agreement (per customer, dated lines) → Invoice (snapshot)
```

**Catalogue** (`CommercialCatalogue`, in `domain/models/commercial.ts`):
- **Package terms:**
  - monthly and annual price;
  - price status;
  - included storage, with its own status;
  - included schemes, and the price per extra scheme.
- **Add-on terms:**
  - price;
  - billing frequency;
  - price status;
  - optional usage allowance.
- **Versions:** each change is a new version from a date. History is kept, with who changed it and why.
- **Price status:**
  - `awaiting`: no price decided;
  - `proposed`: an example, not approved;
  - `approved`.
- **No base-package price is invented.** All three packages are *awaiting configuration*.

**Example values, all marked proposed:**

| Item | Proposed value |
|---|---|
| WhatsApp Communication | R100 a month, 500 messages included |
| Storage packs | R150 for 10 GB, R600 for 50 GB, R1 000 for 100 GB a month |
| Included storage | 5 GB Essentials, 25 GB Professional, 250 GB Enterprise (or negotiated) |

There is no *Business* tier: the repository's packages are Essentials, Professional and Enterprise, so the 100 GB row of the brief has no package.

**Annual renewal fee** (added 13 October 2026):
- An optional fee charged **once a year** on the renewal date, on top of the recurring price. It is never part of the monthly total or MRR.
- **Catalogue:** each package's terms can carry a default renewal fee (`annualRenewalFee`).
- **Agreement:** each agreement holds its own renewal date and fee (`renewal`). A package at catalogue price brings the catalogue fee, unless the agreement already has an agreed fee. An Account Manager can set, change or remove the fee (*Billing & agreement › Annual renewal*), audited.
- **Invoicing:** the fee goes on the invoice whose period includes the renewal date. Once invoiced, the renewal date moves on a year.
- **Shown to:** the customer, on *Plan & features* (their own fee only). The customer header's *renews* date comes from the agreement.
- **Demo:** Umgeni has an agreed R3 000 renewal fee on 15 November 2026, so its next invoice shows it.

**Agreement** (`CommercialAgreement`): what this customer agreed to pay.
- **Dated lines:** package lines and add-on lines, each with `from` and `until`.
  - A line with a future `from` is a **scheduled change**.
  - It takes effect on its date with no job to run: whatever is in force on a date is what applies.
- **Each line keeps its own price** and where it came from:
  - the catalogue price when agreed (with the catalogue version);
  - a negotiated price;
  - included in the agreed package price.
- **Adjustments:** recurring discounts (amount or percentage), credits and once-off fees.
- **Billing preference:**
  - billing email;
  - next billing date;
  - cycle (monthly or annual);
  - the mandate *reference* at the payment provider (never card details).
- **Storage:** temporary storage exceptions, and an optional negotiated allowance.
- **History:** who changed what, why, from when, and on whose authority (D11).

**Invoice** (`HumoInvoice`): a snapshot of the lines and prices that applied.
- It is never recalculated from the catalogue.
- **Paid** only when verified payments cover it.
- **Overdue** is worked out from the due date.

## 3. Prices, calculations and price protection

**The recurring total** (`chargesOn(agreement, date)`):
- **Adds up:**
  - the package in force;
  - extra schemes beyond the package allowance (catalogue-priced agreements only);
  - add-ons (annual add-ons as a monthly equivalent);
  - recurring discounts.
- **Kept apart:**
  - once-off fees and credits, which go on the next invoice;
  - usage charges, which are not in the recurring total;
  - tax.
- **Lines without a price** show as *Price to be agreed*. They are counted, not silently treated as zero.

**Price protection:**
- A catalogue change is a new version from a date. **Existing agreements keep their line prices.**
- Only an authorised change to the agreement changes what a customer pays.
- New agreements and new lines take the catalogue price in force on their start date.
- Issued invoices keep their prices.
- All of this is covered by tests.

**Existing customers:**
- The seeded book of business (184 customers, R1.84 m MRR) is imported as agreements at the recorded contract value, marked *Agreed price*.
- Their existing add-ons are *Included in the agreed package price*.
- The board-level totals are unchanged.

**Mid-cycle changes ⚑:**
- **Default policy:** *next billing cycle*. A change is charged in full from the first invoice after it takes effect, and nothing is pro-rated.
- **Alternative:** *daily pro-rata*, configurable in commercial settings. The invoice then charges each line for the days it was in force.
- The policy is shown as **awaiting business approval** wherever it applies, including the change preview.

**Who may change what:**

| Change | Who | Controls |
|---|---|---|
| Catalogue terms, add-ons | System Administrator (`Platform.Packages.Manage`) | Step-up, reason, audited |
| Commercial settings (thresholds, proration, tax, designated account manager) | System Administrator (`Platform.Config.Manage`) | Step-up, reason, audited |
| A customer's agreement (package, add-ons, discounts, billing preference, storage exception) | Account Manager **for their own customers**, or System Administrator (`Platform.Subscriptions.Manage`) | Step-up, reason, audited. D11: no separate approval. |
| Issue invoices, verify payments | System Administrator (`Platform.Billing.Manage`, **new**) | Step-up for issuing and reconciling |

**Visibility:**
- **Support** can't see prices or agreements, because they don't have `Platform.Revenue.View`.
- **Executives** can see them but can't change them.
- **Customers** see only their storage, their billing preference and their next invoice date (*Settings › Plan & features*).

## 4. Client subscription screen

**Where:** *Platform › Customers › {customer} › Billing & agreement*.

**What it shows:**
- **Recurring total:** package, add-ons and discounts per month, with the price basis of each line. VAT is shown separately, or *Not charged*.
- **Next invoice:** once-off fees and credits, and usage notes (e.g. the WhatsApp allowance).
- **Billing:** billing preference, next billing date, cycle, and the account manager (live from the staff record).
- **Scheduled changes:** the change in the monthly total from each date. Each can be cancelled before it takes effect.
- **Storage:** the storage card (§5).
- **Invoices and payments.**
- **Agreement history:** who changed what, why, when it takes effect, and the approval basis.

**Changing it:** *Change package*, *Add an add-on* and *Remove an add-on* open a drawer with a **live preview**.
- The preview shows the recurring total before and after on the effective date, and the difference.
- It also shows each line, the first invoice that includes the change, and the proration policy.
- The API computes the preview and nothing is saved until *Confirm* (with step-up).
- A future date turns the button into *Schedule change*.

**Manage features** (*Subscription & features*) still works for trials and overrides (D11). Package and add-on changes made there are effective today and **keep the agreed price**. The screen points to *Billing & agreement* for priced and scheduled changes.

**Platform › Pricing & add-ons** (`/platform/pricing`):
- **Packages:** commercial terms, future versions and history.
- **Add-ons:** price, status, usage allowance and features. *New add-on* and *Edit* need System Administrator.
- **Commercial settings.**
- **Payment provider:** *Not chosen yet*.

## 5. Storage quotas

**Allowance:**
- The package allowance (or a negotiated one);
- plus purchased storage packs × quantity;
- plus unexpired exceptions.

**States** (thresholds configurable, initially 80% and 95%):

| State | When |
|---|---|
| Within allowance | below the first threshold |
| Over 80% | from the first threshold |
| Over 95% | from the second threshold |
| Full | at or over the allowance |

**What counts:**
- documents uploaded by the agency, owners and residents;
- photos and images;
- files Humo generates for the customer to send or keep (statements, letters, packs).

**What doesn't count:**
- backups and disaster-recovery copies (Humo's responsibility);
- audit logs and system records;
- Humo's own templates.

**When the allowance is used up:**
- The simulated API refuses uploads with a clear message (`StorageMeter.checkUpload`).
- **Nothing is charged, and no package is upgraded, automatically.**
- The account manager adds a storage pack (*Add storage*) or grants a temporary exception, both audited.
- The customer's administrator can *Ask Humo for more storage* from Plan & features.

**Measured vs simulated:**
- Every figure in the demo is a **demo measurement**, labelled as such.
- In the demo agency, the figure includes files uploaded since the simulation started.
- **No quota is enforced in production until the API checks it before accepting an upload.** The UI says *Not yet enforced by a server* (`enforcedByServer: false`).

## 6. Billing preferences, payments and tax

**Billing preference** (on the agreement), kept separate from the state of each payment:

| Preference | Meaning |
|---|---|
| **Recurring card payment** | The intended default, where the provider and the customer's mandate support it. Humo keeps only the mandate reference. |
| **Online bank payment (Instant EFT)** | The customer pays each invoice through the provider's payment page. |
| **Manual EFT** | Humo invoices and reminds. A payment counts only once **reconciled with Humo's bank statement** by someone with `Platform.Billing.Manage`. |

**Payment states:** *Checkout started*, *Awaiting verification*, *Verified*, *Failed*, *Cancelled*.
- An invoice is **paid only with verified payments covering it**.
- Starting a checkout is not a payment.
- Every payment in the frontend is marked **simulated**, and the UI says so ("Paid (simulated)").

**Provider boundary:**
- `PaymentGateway` (`domain/ports/commercial-data-sources.ts`) is the only place a provider plugs in: Payfast, Peach Payments or another.
- Subscriptions and invoices never know which provider is used.
- The demo binds `SimulatedPaymentGateway`, which hands out references and never redirects or charges.

**Prepared, but not live:**
- **References:** unique invoice references (`HPM-{customer}-{yyyymm}`), which are also the payment reference.
- **Invoices** built from the agreement as it stood (`buildInvoice`).
- **Checkout initiation:** the redirect URL comes from the provider.
- **Duplicate notifications:** a repeated provider notification id changes nothing.
- **Failed and overdue states.**
- **Payment history and audit events.**

**Not done in this milestone:**
- live transactions;
- recurring charges;
- card collection;
- webhook processing.

**Where invoices are, and whether they're sent:**
- **Not sent.** In this milestone no invoice is emailed. They're created in the browser (the demo data, or *Issue next invoice (simulated)*).
- **Humo staff** (with `Platform.Revenue.View`):
  - ***Platform › Invoices*** (`/platform/invoices`, added 13 Oct 2026) lists every customer's invoices, with totals (outstanding, overdue, paid this month), status filters and search;
  - each invoice opens as a printable document (*Print or save PDF*);
  - a customer's own invoices and payment actions are on *Customer › Billing & agreement › Invoices & payments*.
- **Customers' Agency Administrators** (`Subscription.Request`, own organisation only):
  - ***Settings › Billing & invoices*** (`/settings/billing`) shows how they pay, what's outstanding, and their invoices;
  - each invoice opens as the same printable document;
  - they see payment summaries only: no provider references, internal notes or Humo staff names;
  - another customer's invoice can't be opened, even by URL. The API checks the organisation.
- **Backend work (R-14):** the billing run emails each invoice as a secure link to that page, and *Pay now* opens the provider's checkout.

**Tax ⚑:**
- `TaxConfig` holds Humo's legal name, registration number, VAT registration, VAT number and rate.
- **Humo charges VAT only when it is configured as VAT registered.** It is off in the demo data, and the legal entity is *to be confirmed*.
- Invoice numbering follows D10: gapless sequential numbers only when Humo issues VAT tax invoices, which needs the tax decision first.

## 7. The designated Humo Account Manager: Mashoto Moropane

**In the demo:**
- **Identity:** a Humo identity, `am-mashoto`, with the Account Manager role, labelled *demo seed*.
- **Customers:** Mashoto looks after **Acacia** and **Fynbos** (`demo-data/platform/account-managers.json`).
- **Designated for new customers:** `designatedAccountManagerId`, changeable by a System Administrator.
- **Credentials:** none exist. "Sign in as" in the demo is simulated (R-8).

**How the name is used:**
- Every screen shows the account manager's name from the staff record, so a reassignment shows everywhere at once.
- Reassignment stays where it was: *Humo team › member › Customers*, audited.

**To set Mashoto up for real** (an administrator, once the identity provider exists, D5):
1. A System Administrator invites Mashoto on *Platform › Humo team* with their real work address and the **Account Manager** role.
2. Mashoto registers a passkey through the identity provider.
3. The System Administrator assigns their customers on the member page and checks the designated account manager in *Pricing & add-ons › Commercial settings*.
4. Remove the demo seed entry from the demo data only if the real directory replaces it. The demo keeps its synthetic copy.

## 8. Decisions for approval ⚑

1. **Base package prices**, and whether packages are also priced by portfolio size (included schemes, price per extra scheme).
2. **Proposed example prices:** WhatsApp, storage packs, and the storage allowances per package.
3. **Mid-cycle proration policy:** next cycle (default) or daily pro-rata.
4. **VAT registration** and Humo's legal entity on invoices; then tax-invoice numbering (D10).
5. **New permission `Platform.Billing.Manage`** on the System Administrator role (issue invoices, verify payments). This adds a permission to a fixed role (D4), so it needs explicit confirmation. The alternative is a separate Humo Finance role, which would be a new role under D4.
6. **Whether discounts above a threshold need a second approver.** Today D11 applies: no separate approval, every change audited.
7. **The payment provider:** Payfast, Peach Payments or another.
8. **Annual renewal fees:** whether packages carry a default fee, and how much. None is set in the catalogue.
9. **The sole-administrator safeguard** (doc 16): the 24-hour cooling-off period.

## 9. Backend work

These are register items R-12 to R-14.
- **Storage:** persist the catalogue (versions), agreements (dated lines, adjustments, history), invoices and payments. Make issuing atomic, with unique references.
- **Calculations:** the same rules as `domain/models/commercial.ts`: `chargesOn`, `checkAgreementChange`, `applyAgreementChange`, `buildInvoice`. Port them rule for rule, with these tests as the specification.
- **Payment provider:** the integration behind `IPaymentProvider`:
  - create checkout / mandate;
  - verify the notification signature and the amount against the invoice;
  - idempotency by provider event id;
  - reconciliation;
  - failed-payment retries and overdue reminders.
- **Storage enforcement:**
  - a storage service measuring usage per organisation;
  - quota checks **before** accepting an upload;
  - threshold notifications;
  - exceptions that expire.
- **Billing run:** issue invoices on the billing date; email the invoice link; send reminders.
