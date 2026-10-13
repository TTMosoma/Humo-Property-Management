# Demo-readiness matrix

**What the demo at pm-demo.humo.co.za can show, and how real each part is.**
- **Demonstrable:** works end to end in the simulation, with coherent demo data.
- **Simulated:** what the backend still has to make real. Each item has a register entry in [../18-production-readiness-register.md](../18-production-readiness-register.md).

Update this table with every feature change (checklist in [demo-data-strategy.md](demo-data-strategy.md) §7).

| Area | Demonstrable | Demo data | Simulated / not built | Register |
|---|---|---|---|---|
| Sign-in, personas, step-up | Yes | Personas (`personas.ts`) | Passkeys, sign-in links | R-8 |
| Portfolio: schemes, units, owners, balances | Yes | Generated seeds | Persistence | R-6 |
| Levies, billing runs, statements | Yes | Generated seeds | Statements rebuilt from today's ledger and labelled *Preview* | R-1, R-2 |
| Receipts, statement import, meter readings, levy model | Yes | Generated seeds | File parsing in the browser | R-10 |
| Maintenance, suppliers, quotes | Yes | Generated seeds | Contractor messages and invites | R-3, R-4 |
| Governance, rules, meetings, compliance | Yes | Generated seeds | Uploaded files open only for the session | R-11 |
| Communications | Yes | Generated seeds | Delivery results | R-5 |
| Humo team, account requests and approval | Yes | Personas, requests | Notices are in-app only | R-9 |
| **Commercial catalogue** (prices, add-ons, versions) | Yes | **Canonical** (`demo-data/commercial/catalogue.json`) | Base prices *awaiting configuration*; example prices *proposed* | R-12 |
| **Agreements, scheduled changes, preview, history** | Yes | **Canonical** for named customers; generated for the rest | Persistence | R-12 |
| **Storage quotas** | Yes | **Canonical** measurements (demo) | Measurements; enforcement exists only in the simulated API | R-13 |
| **Invoices and payments** | Yes, simulated | **Canonical** for Tshikrand, Acacia, Umgeni and Fynbos | Invoices aren't sent; payments, provider and bank reconciliation are simulated | R-14 |
| **Invoice lists and documents** (Platform › Invoices; Settings › Billing & invoices) | Yes | Same invoices | Printable document; not emailed; no *Pay now* until the provider is connected | R-14 |
| **Account manager assignment** (Mashoto Moropane) | Yes | **Canonical** (`demo-data/platform/account-managers.json`) | Demo seed identity; no real account | R-8 |
| Tax (VAT) | Configuration only | `settings.json` (not registered) | No VAT decision yet | R-14 |
| Usage-based charges (e.g. WhatsApp beyond the allowance) | Described only | Allowance in the catalogue | Not metered or charged | R-14 |
