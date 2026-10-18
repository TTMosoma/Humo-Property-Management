# Demo limitations

**What to say, and not say, when presenting.** Everything below is listed with its backend work in [../18-production-readiness-register.md](../18-production-readiness-register.md).

## Simulated, and labelled as such on screen

- **Payments.**
  - No money moves. No provider is connected; the demo uses a simulated one.
  - *Simulate provider confirmation* stands in for the provider's server-to-server notification. In production only that verified notification, or a reconciled EFT, marks an invoice paid.
  - Every payment shows *simulated*.
- **Invoices.**
  - Issued in the browser only and never sent.
  - Invoice references are unique, but they aren't tax-invoice numbers (D10; the VAT decision is pending).
- **Bank reconciliation.** *Verify against bank statement* records that someone checked; there is no bank feed.
- **Storage.**
  - Figures are demo measurements.
  - The upload refusal at a full allowance happens in the simulated API.
  - **No quota is enforced in production until the API checks it before accepting an upload.**
- **Prices.**
  - Base package prices are *awaiting configuration*.
  - WhatsApp (R100) and the storage packs (R150 / R600 / R1 000) are *proposed*, not approved.
  - Existing customers' contract values are recorded figures, carried into their agreements as agreed prices.
- **Proration.** The *next billing cycle* policy is a default awaiting business approval.
- **Mashoto Moropane.** A demo seed entry. No login credentials exist. A System Administrator sets up the real account through the identity provider (doc 23 §7).
- **Data per visitor.**
  - Each visitor's changes live in their own browser until they reset.
  - Two people presenting at once don't see each other's changes.

## Data to check before showing externally

- **Acardia PDFs in `docs/`.** Client design files, untracked, not part of the demo data.

## Not built

- **Billing:** a recurring billing run, invoice emails, reminders, and failed-payment retries.
- **Usage charges:** usage metering and charges (e.g. WhatsApp messages beyond the allowance).
- **Billing entity:** a separate Humo Finance role (see doc 23 §8 ⚑5).
