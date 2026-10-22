# Handoff: Humo Property Management, 22 October 2026

This is a handoff for a new Claude session. It records what was built, what was decided, what is waiting on the product owner, and how the project works. Read `CLAUDE.md` and `docs/17-decisions.md` before changing anything.

## 1. Where things stand

| Item | State |
|---|---|
| `main` | Up to date. Merged: #47, #48 (library), #49 (package limits), #50 (basic invoicing), #51 (storage limits). |
| PR #52 | **Open, waiting for Terry to merge.** Advanced finance add-on, proposed at R400 a month. Branch `feature/advanced-finance-addon`. |
| Price of Advanced finance | **Proposed, not confirmed.** Terry said R400 a month; this is recorded in D21 as proposed. |
| Manual testing | **Not done yet.** The steps are in section 6. Automated tests pass. |
| Working tree | Clean except this file. |

Latest checks: backend `dotnet test` 241 passed; frontend `npm test` 125 passed; typecheck, lint and all three builds pass.

## 2. What was built (in order)

- **Onboarding and conventions:** `CLAUDE.md` (naming, decisions, simulated-action tags, git rules, CI).
- **Readiness register** (`docs/18`): R-2, R-5, R-7, R-11 (uploaded files on the API), R-12 (package limits), R-14 (basic owner invoices), R-1 (revoke), R-8 (in progress).
- **Sign-in redesign:** links bound to the requesting browser with a code; session limits; trusted computers; the once-only "is this your computer?" question, with a list in Security settings and sign-out for single sessions.
- **Production deployment requirements** (`docs/18`, D-1 to D-16): forwarded headers only from Caddy, webhook setup, ClamAV, secrets in server `.env`, storage keys.
- **Library on the API (R-11):** scheme documents, unit and job documents, versions, archive and restore, signed links. PRs #47 and #48.
- **Package limits (D16, D17, D18):** units under management, people with a sign-in and SMS are limited by package; schemes are unlimited. Warnings at 80%; refusal at the limit. Essentials agencies at 80% are offered a 30-day Professional trial that they start themselves. Administrators are emailed at 80% and at the limit; other staff see the warning in the app. PR #49.
- **Basic invoicing (D19):** Essentials agencies issue numbered invoices to owners (INV-0001 onwards), record payments by hand, and email invoices on request. Manual statements work on Essentials; bulk statement runs stay on Professional. PR #50.
- **Storage limits (D20):** every uploaded file counts in GB (1 GB = 1024³ bytes). The API refuses an upload past the limit before saving it. Warnings at 80%. Reaching 80% also offers the trial. PR #51.
- **Advanced finance add-on (D21, proposed):** levy management, billing runs, payment allocation, debtors and credit control, for Essentials. Stays on Professional: supplier payments, budgets, financial reporting. PR #52.

## 3. Decisions

- **D15:** commercial terms (Payfast, no VAT, approved prices, daily pro-rata).
- **D16:** package limits: units, users and SMS; schemes unlimited. Terms from 22 October 2026: Essentials 50 units, 5 people, 50 SMS, 5 GB; Professional 250, 25, 250, 25 GB; Enterprise 1 500, 150, 1 500, 150 GB.
- **D17:** Professional includes 25 people; the trial is prompted and started by the customer, not automatic.
- **D18:** limit warnings by email to agency administrators and in the app to staff.
- **D19:** basic invoicing on Essentials; invoices are posted to the unit's account as adjustments.
- **D20:** storage limits, measured and refused by the API.
- **D21:** Advanced finance add-on, **proposed**. The price, and whether levies belong in it, are the product owner's to confirm.

Rule from `CLAUDE.md`: to change a decision, add a new entry that supersedes it. Don't edit history. D21 was edited in place only because it is still a proposal. Once Terry confirms the price, record it as approved in a new entry.

## 4. Still open

**Waiting on Terry:**
- Merge PR #52.
- Confirm or change the R400 price (and that levies belong in the add-on).
- Run the manual test steps in section 6 and report results.

**Register items still open** (`docs/18`):
- **R-13 (storage):** generated files (statements, letters, packs) are not counted yet; storage packs and temporary exceptions aren't built.
- **R-3, R-4:** contractor quotes and invitations to quote.
- **R-9:** customer account approval screens.
- **R-10:** billing inputs (meter readings, levy model, slice 2b).
- **R-14:** online payment (Payfast end to end on the server needs public HTTPS).
- **R-6:** remove simulated tags and the demo layer; the prototype still shows simulated customers (Acacia, Fynbos). Resetting the seed data was agreed in principle, not done.
- **Compliance module** (replaces compliance and vetting documents).
- **Go-live readiness** (`docs/18`, D-1 to D-16): staging checks, mail webhook setup, ClamAV, production secrets.

**Known gaps:**
- The prototype's limit banner and storage figures only show through the API (`npm run start:api`), not the plain prototype.
- The invoice page in the prototype shows an empty list.
- Only levies, billing runs, payment allocation, debtors and credit control are in the Advanced finance add-on, so the features need checking against Essentials agencies.

## 5. Conventions

- **Git:** work on a branch and open a PR into `main`. Never commit straight to `main`. Terry merges PRs himself.
- **Commit author:** `Terry Mosoma <TTMosoma@gmail.com>` for this project. Check with `git config user.email` before committing. The global git config on the Mac is a different (work) address, so pass `-c user.name="Terry Mosoma" -c user.email="TTMosoma@gmail.com"` on commit.
- **Commit trailer:** `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.
- **PR description ends with:** `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Before a PR:** typecheck, lint, tests and the three frontend builds; `dotnet build` and `dotnet test backend`. The production build must not contain demo data (R-6, CI checks it).
- **.NET on this Mac:** run `export PATH="$HOME/.dotnet:$PATH"` first (the SDK isn't on the default PATH).
- **Migrations:** `dotnet ef migrations add <Name> -p src/Humo.Infrastructure -s src/Humo.Api -o Data/Migrations`. Back up before migrating production.
- **Editing JSON:** the catalogue is written with `indent=2`, `ensure_ascii=False`, and a trailing newline. Round-tripping keeps the diff small.
- **Demo data:** the catalogue is `demo-data/commercial/catalogue.json`. Add-ons are data, so a new add-on needs no code, only features the app already knows (`contracts/entitlements.json`).

## 6. Manual test guide (not yet run)

Start the stack:

```bash
docker compose -f backend/deploy/docker-compose.dev.yml up -d
dotnet run --project backend/src/Humo.Api
npm --prefix frontend/humo-web run start:api
```

Sign in at http://localhost:4310 as `terry@humo.co.za` using the sign-in link in Mailpit (http://localhost:8025). Use an agency on Essentials.

1. **Units warning:** at 40 units the staff banner shows 40 of 50 units. The administrator is emailed and it appears in the bell.
2. **Units refused:** the 51st unit fails with a message naming Humo Essentials.
3. **Professional trial:** at 80% the banner offers *Try Humo Professional free for 30 days*. Starting it changes the banner; a second trial isn't offered.
4. **People limit:** a sixth person can't be invited (invitations need a passkey check first).
5. **Storage:** uploading a PDF moves the storage figure on `GET /api/me/limits`.
6. **Library:** upload, edit, archive, restore and open a document on a scheme.
7. **Basic invoicing:** issue an invoice to an owner with an email address (INV-0001), record a payment, check it can't be overpaid, and email it (it lands in Mailpit).
8. **Manual statement:** send one owner a statement that includes the invoice.

## 7. Next steps, in order

1. Terry runs the manual tests and reports anything that differs.
2. Terry merges PR #52 and confirms the price.
3. Then pick the next register item (R-13 generated files, or the R-6 demo clean-up, or R-3 and R-4).

Open question: Terry said "switch back to Capitec" but it wasn't clear whether he meant the commit author for this repo, or something else. Ask before changing any git config.
