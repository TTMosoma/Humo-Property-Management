# 29 — Commercial review: WeconnectU, our weaknesses, and the plan to win (26 November 2026)

**Status:** analysis and proposals. The product owner's decisions from this review are in [D47](17-decisions.md#d47--customer-data-fees-and-fair-terms-26-november-2026). The packages and prices are proposed in [D48](17-decisions.md#d48--packages-prices-and-unit-add-ons-proposed-26-november-2026) and wait for approval.

**Sources** (read in full, 26 November 2026):
- WeconnectU's onboarding email, sent after a sales meeting;
- the *CMS Software Agreement* (February 2026, 17 pages);
- the *Community Management Solution Pricing Schedule 2026* (4 pages);
- the *CMS Fee Structure 2026* price calculator (Excel);
- the *CMS Trustee Brochure* (15 pages);
- for comparison, screenshots of ANGOR Property Specialists' owner portal (17 November 2026, see [#138](https://github.com/TTMosoma/Humo-Property-Management/pull/138)).

Nothing here is legal advice. The items marked ⚖ need a South African attorney's confirmation before launch.

---

## 1. What WeconnectU sells

| Area | What they offer |
|---|---|
| **Products** | Community Management (CMS), rentals (RAMS), and inspections and maintenance (RedRabbit) |
| **Trustee portal and app** | Current and investment bank balances; supplier invoices to approve, with the bank balance shown first; age analysis; levy roll; debt-collection status; maintenance; transfers of sold units; warnings and penalties; tasks; documents |
| **Monthly Community Report** | Emailed to trustees every month, interactive or as a PDF: compliance, finances, operations |
| **Compliance planner** | 12 months of statutory activities ahead |
| **Meetings** | Quorum, proxies, voting, AI-drafted minutes with action items |
| **Owner portal** | Invoices, statements, tasks, fines, email history, documents |
| **Collections** | Levy debit orders through Netcash; a pre-legal arrears module |
| **Onboarding** | A planning meeting, configuration, data migration (including take-on balances), 12 training topics over 8 weeks, then 4 weeks of "hand-holding" |
| **Support** | Business hours by email and phone, a knowledge base, weekly refresher sessions. Fixing customer mistakes is billed |

Their positioning is the lesson: *"Creating more valued and valuable Property Managers."* They sell the agency on looking good to its trustees.

## 2. Their prices (excluding VAT)

| Item | Price |
|---|---|
| Onboarding (setup, branded marketing pack, first community, demo community, training) | R6 500 once-off |
| Data migration, each further community | R590 once-off |
| Monthly, up to 400 units | R2 950 minimum |
| Monthly, 401–3 500 units | R7.25 a unit (**all** units, from the first) |
| Monthly, 3 501–10 000 units | R5.23 a unit (the units above 3 500) |
| Monthly, over 10 000 units | R3.96 a unit (the units above 10 000) |
| Arrears | 15% of the pre-legal admin fees charged to owners (e.g. R3.15 of a R21 notice fee, R22.50 of a R150 letter of demand) |
| SMS | 61c each |
| Extra work, including fixing customer mistakes and retrieving data after cancelling | R590 an hour |
| The agency's own company books | R277 a month per company |

**Mistakes in their calculator:**
- **Price inversion:** 400 units cost R2 950, but 401 units cost R2 907.25.
- **Wrong label:** it says "R545 per community" but calculates at R590.
- **Hard-coded count:** migration is charged on a hard-coded 22 communities while the input says 23.
- **An error in the header:** `#VALUE!`.
- **No once-off total:** for its own sample (500 units, 23 communities) that's R19 480 before the first month.

Their pricing is opaque and hand-built. Ours should be public, correct and calculated by the system.

## 3. What "commercial terms" means

Commercial terms are the money and contract rules around the software:
- what the customer pays, how it's calculated and when it's billed;
- how long the contract runs, and how to leave;
- who may change prices, and with how much notice;
- what is and isn't included;
- what happens to the customer's data.

**"Billed per unit"** means the monthly fee depends on how many units the agency has loaded, not on schemes or staff. A unit is any apartment, townhouse, erf or commercial unit. It is also any parking bay or storeroom that's billed as its own section with its own participation quota. Every unit added raises the next invoice. For example, 1 000 units × R7.25 = R7 250 a month.

**WeconnectU's terms, and what they mean for an agency:**

| Term | What it means |
|---|---|
| Indefinite term, 2 months' written notice, notice period not refunded | Leaving costs at least two months' fees |
| Data export (CSV) only during the notice period; afterwards R590 an hour | The agency's own records are held back once it leaves |
| Fees and terms change at their sole discretion, on 30 days' notice | Prices can rise every year, with no cap |
| Support excludes fixing the customer's mistakes (R590 an hour) | Corrections cost money |
| Billed in advance by debit order on the 5th, for a variable amount | The amount taken can change month to month |

## 4. Regulators and industry bodies

Humo is the software, not the managing agent.

| Body | What it is | Does Humo need it? | What we do |
|---|---|---|---|
| **PPRA** | Regulates property practitioners. Managing agents need a valid Fidelity Fund Certificate (FFC) for the firm and its principal | No, as long as Humo never manages schemes or holds trust money ⚖ | Levy money never passes through Humo: owners pay into each scheme's own Payfast merchant (D25). We verify customers' FFCs and track renewal dates (§7) |
| **Information Regulator** (POPIA, PAIA) | Data protection | **Yes** | Register WeDesign Solutions' Information Officer. Publish a PAIA manual (check the small-business exemption ⚖). Sign a written operator agreement with every agency (POPIA requires one). Keep a breach procedure |
| **CSOS** | Every scheme registers with it, files returns, pays its levy, and goes there for disputes | Not as a registrant | Build for it: CSOS returns in Compliance; disputes (D40) |
| **STSMA and its Prescribed Management Rules; HOA constitutions** | The law schemes run under | Not a registration | The product follows it |
| **Council for Debt Collectors** | Registers people who collect debts for others for a fee | Check before Humo earns anything from collections ⚖ | We take no cut of collection fees (D47) |
| **SARS** | Tax | Humo's own tax only | **VAT:** Humo isn't VAT-registered. Registration becomes compulsory once taxable sales pass the threshold, currently R1 million in 12 months; check the current figure ⚖. At the proposed prices that's roughly 25–30 Professional customers. Prices should be set now so they still work as VAT-inclusive prices (§6) |
| **Payment rules** (PASA, the National Payment System Act) | Who may collect payments for others | No, while Payfast collects | Levy debit orders would go through a licensed provider, never Humo itself |
| **Consumer Protection Act** | Protects consumers, including small companies | May cover our smallest customers ⚖ | Fair cancellation terms (D47) |
| **NAMA** | National Association of Managing Agents: industry body, voluntary | No, but worth joining | **Join when we're preparing version 2,** which is for agencies we don't yet have a relationship with (product owner, 26 November 2026). A sales and trust channel: supplier membership, events, aligning onboarding with its *Nuts & Bolts* course |
| **ARC** | Association of Residential Communities: estates and HOAs | No | The same, for estates, also from version 2 |

## 5. Where Humo is weak today

Checked against the code and decisions on 26 November 2026.

| # | Weakness | Evidence | Effect |
|---|---|---|---|
| 1 | **Essentials can't bill levies** | Levies, billing runs and statements are Professional features (`contracts/entitlements.json`); Essentials needs the R400 Advanced finance add-on (D21, D22) | A one-person agency's main job isn't in the package meant for it |
| 2 | **AGMs are Enterprise-only** | D29 keeps Meetings & AGMs in Enterprise or as an add-on | Every scheme must hold an AGM. WeconnectU includes meetings |
| 3 | **Owners and trustees count as "people"** | `PackageLimits.UsageAsync` counts every active membership, residents included. Professional allows 25 | An agency with 250 units can give portal access to about 20 owners. WeconnectU has unlimited logins |
| 4 | **Price cliff from 251 to 1 499 units** | Professional stops at 250 units; Enterprise costs R9 600 | A 300-unit agency pays us R9 600 against WeconnectU's R2 950: 3.3 times more |
| 5 | **No price above 1 500 units, and no unit add-ons** | The catalogue has no units add-on; Enterprise stops at 1 500 | We can't sell to a large agency |
| 6 | **No way to move in mid-year** | Data migration (opening balances and history) is still open in docs/17 | An agency can't switch without starting its books again |
| 7 | **No legal pack** | No published agreement, operator agreement, Information Officer registration, PAIA manual, subprocessor list or support terms | Agencies, and their attorneys, will ask for these before signing |
| 8 | **Collections** | Owners pay by card through Payfast (D25); no levy debit orders | Debit orders are the norm for South African levies |
| 9 | **Trustee features they already have** | Our monthly reports are planned for version 2, Compliance comes after version 1, and the mobile app comes later | Their brochure sells exactly these to trustees |
| 10 | **No banking view** | We import bank statements, but have no bank feed and no bank balances for trustees | Trustees ask "how much is in the account?" |
| 11 | **How agencies find us and get help** | No references or case studies yet; no knowledge base, training programme, support hours or status page | A new brand has to earn trust |
| 12 | **Key-person risk** | One product owner and one account manager | Support and outages need cover (docs/26) |

Not yet checked: whether our ledger produces an auditor-ready trial balance and year-end pack. Every scheme's books are audited, so this needs checking before launch.

## 6. Packages and prices

Proposed in [D48](17-decisions.md#d48--packages-prices-and-unit-add-ons-proposed-26-november-2026).

**Against WeconnectU** (their prices exclude VAT; Humo charges none). These are the revised prices, to the product owner's targets of 20–30% cheaper, and 1.5 times cheaper at 300 units:

| Units | WeconnectU | Humo today | Proposed | Package | Cheaper by |
|---|---|---|---|---|---|
| 50 | R2 950 | R600 | **R699** | Essentials | 76% |
| 200 | R2 950 | R2 400 | **R1 248** | Essentials + 100 units | 58% |
| 300 | R2 950 | R9 600 | **R1 949** | Professional | 34% (1.5×) |
| 500 | R3 625 | R9 600 | **R2 498** | Professional + 100 units | 31% |
| 1 000 | R7 250 | R9 600 | **R5 097** | Professional + 600 units | 30% |
| 2 000 | R14 500 | not sold | **R10 096** | Professional + 1 600 units | 30% |
| 4 000 | R27 990 | not sold | **R20 094** | Professional + 3 600 units | 28% |
| 5 000 | R33 220 | not sold | **R22 999** | Enterprise | 31% |
| 10 000 | R59 370 | not sold | **R40 998** | Enterprise + 5 000 units | 31% |
| 20 000 | R98 970 | not sold | **R76 996** | Enterprise + 15 000 units | 22% |

Below 400 units WeconnectU charges a flat R2 950, so a small agency saves more than 30% with us whatever we do.

**Covering our costs.** Our costs come in two kinds:
- **Fixed costs** are paid whether we have one customer or a hundred: the server, the domain and email, backups, accounting, our own time.
- **Variable costs** grow with each customer: included SMS, storage, Payfast's fee on our invoice, support time.

A price can only make sure each customer pays well above their *own* variable cost. That's the margin. Covering the fixed costs takes enough customers: **break-even = fixed costs ÷ margin per customer.**

No price covers the fixed costs with one customer. WeconnectU's R2 950 minimum wouldn't either. With one customer for a year we run at a loss at any price, which is why the launch offer and the first agencies matter.

For example, if fixed costs were R15 000 a month (an example only, not our figure), we'd break even at about 25 Essentials customers, or 9 on Professional. **We need the real figures:** fixed monthly costs, and the price of an SMS. The included SMS allowances (50, 300 and 3 000 a month) are kept modest because each SMS costs us money.

## 7. Fair terms

These are our answers to WeconnectU's terms. Decided in [D47](17-decisions.md#d47--customer-data-fees-and-fair-terms-26-november-2026).

| Their clause | What we promise | Where it's enforced |
|---|---|---|
| 9.6: they may be paid by third parties | Any income Humo earns from third parties (sponsors, suppliers, partners) is disclosed and labelled. There are no hidden commissions | Terms; sponsorship labels in the product |
| 9.7: they may share non-personal data you upload | We never sell or share customer data, personal or not. Anonymised benchmarks only with the agency's opt-in | Terms; operator agreement |
| 10.8: personal information stored outside South Africa | Data is hosted in South Africa. Our subprocessors (Payfast, the SMS and email providers) are listed, with where they process data. Changes are notified 30 days ahead | Privacy notice; subprocessor page |
| 12: one-sided indemnities | Balanced liability: each side answers for its own breaches | Agreement |
| 6: data only during notice; paid retrieval after | Export everything at any time while active, and for 30 days after leaving, at no charge. After that, the agency's account owner keeps the archive for R500 a month (D47) | Product: export; exit; archive |
| 9.3 and Schedule 1: prices and terms change at their sole discretion | Prices change at most once a year, with 60 days' notice, and the customer may leave without penalty (proposed) | Agreement; billing |
| 5.1.2 and 8.1.3: paying to fix your own mistakes | Corrections in the app are free and audited. Custom work is R450 an hour, quoted in writing first | Terms; support process |
| 10.7: breach notification | We tell the agency as soon as we know, within 24 hours (proposed), and help it notify the Regulator and the people affected | Breach procedure (docs/26) |
| 3.3: instructions only from named administrators | Humo's System Administrators act on a customer's data only at an Agency Administrator's request, or the account owner's once the account has closed. Support access is audited (already built) | Support process |

## 8. The plan: 10 times stronger

**One promise:** *Switch in a week, half the price, trustees love it, nothing hidden.*

### Before launch (version 1)
1. **The new packages and prices** (D48):
   - Essentials gets levy billing.
   - AGMs move into Professional.
   - Owners and trustees are never counted against a limit.
   - Unit add-ons fill the gaps.
2. **Free migration, built into the product.**
   - Import the levy roll, owners, tenants and opening balances (trial balance, debtor and supplier age analyses).
   - A reconciliation check before go-live: the imported balances must agree with the trial balance.
   - Humo staff help free of charge; it's covered by the annual fee.
3. **The legal pack:** the subscription agreement with the fair terms, the POPIA operator agreement, the Information Officer registration, the PAIA manual, the breach procedure and the subprocessor list.
4. **Full data export**, available at any time (D47).
5. **Verified agencies:** we check the firm's and principal's FFCs at onboarding and track renewals. A *Verified managing agent* mark can be shown to trustees.
6. **Self-service sign-up:** a 30-day trial and a correct price calculator on the website.

### First six months after launch
7. **The owner and trustee "app"**: install Humo PM on the phone from the browser (a web app). That's quick, and the native Humo Mobile follows later.
8. **Levy debit orders** through a licensed provider.
9. **Support you can see:** a knowledge base, weekly online onboarding sessions, published support hours and a status page.
10. **Growth channels:**
    - auditors of bodies corporate, who recommend software;
    - a referral month: one month free for each agency referred;
    - the launch offer: Professional free for 1 to 3 months for Essentials customers (D48).

### Version 2 (for agencies we don't yet have a relationship with)
11. **Join NAMA and ARC** while preparing version 2.
12. **Monthly reports** in the app, and as a PDF emailed to the Agency Administrator (D47). The same pack for trustees, as their "Community Report".
13. **Compliance planner** and CSOS returns; AI-drafted meeting minutes.
14. **Scheme handover:** when a body corporate moves between two agencies on Humo, its history moves with it, with the trustees' consent. When it leaves Humo, a complete handover pack.
15. **Agency branding** in the app; Enterprise's own domain (#138).
16. **Membership register confirmation** by owners (#138).

### Bigger bets (each needs its own decision)
- **Trustee pull:** trustees who've seen Humo ask their agency for it. The scheme-handover flow makes Humo the place a scheme's history lives.
- **Revenue that never comes from owners' arrears.** For example, conveyancers ordering levy clearance figures online and paying a platform fee. The agency's own fee to the conveyancer is separate and set by the agency.
- **Self-managed schemes:** a plan for bodies corporate without a managing agent, routed to verified agencies when they want one. This needs care so we don't compete with our own customers.

## 9. Open questions
1. **The cost model:** fixed monthly costs and the price of an SMS, to confirm D48's margins and our break-even.
2. **Approving D48's prices.**
3. **The launch offer's length,** 1 to 3 months.
4. **D47's remaining open items:** archiving on day 30 if no one has, how long an unpaid archive is kept, and the proof needed to set the account owner.
5. **Settled on 26 November 2026:**
   - data migration with opening balances is in version 1;
   - NAMA from version 2;
   - archive access at R500 a month;
   - annual fees of R499, R2 400 and R12 000;
   - in-person training quoted separately.
