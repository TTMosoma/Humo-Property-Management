# 05 — Humo Contractor: the foundation

> **Update, 11 October 2026:** the Contractor portal described here (`features/contractor-portal`, `/contractor`, the "Contractor / Supplier" role and the Themba persona) was **removed from Humo PM**. Humo Contractor is now a separate app, `frontend/humo-web/projects/humo-contractor`, with only a landing screen. Humo PM keeps its side: quote requests, comparison, messages, email invites, supplier profiles and endorsements, through the `ContractorNetwork` port. See [20-humo-contractor-separation.md](20-humo-contractor-separation.md). The rest of this page is kept as the original design record.

Status: **Foundation implemented in the frontend prototype (mock data).** This is **not a marketplace**. Humo PM remains the product; Humo Contractor is a separate capability it consumes, built so it can become its own product later. Decisions marked ⚑ need approval.

```
Humo Platform
 ├─ Humo Property Management   — consumes contractor capabilities through the ContractorNetwork port
 ├─ Humo Contractor            — owns businesses, profiles, quotes, reputation (ContractorPortal port)
 └─ future products
```

## 1. Boundaries

| Layer | Location | Rule |
|---|---|---|
| Domain | `domain/contractor/` | Imports nothing from Humo PM. Not re-exported from `domain/index.ts`: Humo PM imports it explicitly. |
| Ports | `ContractorNetwork` (customer-facing), `ContractorPortal` (contractor-facing) | Humo PM only ever touches contractor data through `ContractorNetwork`. |
| Mock service | `mock/contractor/` | Its own store and seed, standing in for a separate service with its own database. |
| Contractor UI | `features/contractor-portal/` | Its own shell at `/contractor`, outside the PM shell. Uses only `ContractorPortal`. |
| Shared UI | `features/contractor-shared/` | Verification badge, reputation, endorsements. Depends only on the contractor domain. |

**The one handover point** is the `award-network-quote` job action:
- Accepting a quote in Humo PM records the chosen quote on the PM job.
- From there it is a normal job: approval, then work order, then invoice, then payment.
- The contractor's work order reflects the job's progress. In the prototype this is a mock join; in production it would be an integration event feed.

## 2. Contractor vs supplier (no duplicate entities)

- **`BusinessParty`** is one business on Humo, with `capabilities: ['contractor' | 'supplier']`.
  - A contractor performs work: maintenance, repair, installation.
  - A supplier provides goods, services or recurring supplies.
  - Many businesses do both.
- **The PM `Supplier`** remains **the agency's relationship** with that business: its vetting, its performance with this agency, and bank details for payment. It links by `partyId`.
- **Two scopes of reputation:**
  - **Agency-level** (this agency's history with them): on the PM Supplier.
  - **Humo-wide** (all customers): on the Humo Contractor profile.
- **Identities:** a contractor's Humo identity is **not owned by an agency**. The role assignment's scope is `{ type: 'party', organisationId: null, partyId }`.

## 3. Models

| Model | Purpose |
|---|---|
| `BusinessParty` | Trading and legal name, registration, VAT, capabilities, contact (protected) |
| `ContractorProfile` | Party + summary, `ContractorService[]`, `ServiceArea[]`, documents, insurance, verification, reputation, endorsements, availability |
| `ContractorService`, `ServiceArea` | What they do, where, typical lead time |
| `ContractorDocument`, `InsuranceCover` | Compliance, with a `verifiedByHumo` flag |
| `ContractorVerification` | `listed` → `verified` → `recommended`, plus which checks are done. `meetsRecommendedBar()` states the evidence; Humo staff confirm it. |
| `ContractorReputation` | Rating (+ count), completed jobs, completion %, on-time %, quote response % and time, endorsements, Humo relationships, years active. Never a single star. |
| `ContractorRating` | One rating per completed job, from a customer |
| `ContractorEndorsement` | From a Humo **customer organisation** with completed work together (`basedOnCompletedJobs`). Once per customer. Contractors cannot create endorsements. |
| `QuoteRequest`, `QuoteInvitation` | One request → many invited contractors (existing relationship or email invite) |
| `ContractorQuote` | Price, proposed work, exclusions, start / complete dates, validity, guarantee, the customer's own "recommended" flag, status |
| `WorkOrder` | An accepted quote turned into work. Links back to the source record (`{ product: 'humo-pm', ref }`). |
| `ContactDisclosure` / `disclosureFor()` | Contact details hidden until acceptance, unless the agency already works with the business |
| `QuoteLifecycleEvent` | The event stream (see §5) |
| `CommercialModel`, `CommercialPolicy`, `NO_CHARGE_POLICY` | Future revenue rules plug in here; today nothing is chargeable |
| `ContractorQuery` | Discovery criteria (category, area, availability, rating, endorsements, compliance). **Defined, deliberately unused.** |

## 4. Quote workflow (Humo PM)

```
Maintenance request → Contractors chosen → Quote request → Quotes → Approval → Scheduled → Work started → Completed → Invoice
```

1. **Request quotes through Humo Contractor.** This starts on the job (reported stage) at `/maintenance/:ref/quote-request`:
   - Describe the work and list the requirements; the job's photos are shared.
   - Set a deadline.
   - Invite **your own suppliers** for the trade, shown with their Humo reputation, verification and compliance.
   - Invite a business you know **by email** (planned).
   - Humo never suggests contractors you don't know.
2. **Contractors quote** in Humo Contractor. They see:
   - the work, the photos, and the suburb
   - not residents' details or the agent's direct line
   - not competitors' identities or prices
3. **Compare** at `/maintenance/:ref/quotes`:
   - **Workflow stepper** across the top.
   - **Request summary** with who was invited and who declined, and why.
   - **Side-by-side comparison:** price, start and completion dates, guarantee, proposed work and exclusions, Humo reputation, endorsements, response time, compliance, and contact (protected).
   - **Factual labels only** ("Lowest", "Soonest"). There is **no automated pick**. The agent may mark *their own* recommendation.
4. **Accept.**
   - **Agency side:** the business is linked as an agency supplier (or the existing link is reused), and the quote is recorded on the job. Amounts above the R 5 000 delegated limit go to trustee approval; smaller amounts are approved within delegation.
   - **Contractor network:** the request closes. The other quotes are marked "not selected", and a work order is created for the contractor.
   - **Contact:** contact details become visible.
5. **The job continues as usual.**
   - The agency's own vetting still applies. A new supplier without a bank confirmation letter needs an explicit override to book.
   - The contractor's work order follows the job: Awarded → Scheduled → On site → Completed → Invoiced → Paid.

## 5. Lifecycle events (future commercial rules)

**Events recorded:**
- `quote-request-created`
- `contractor-invited`
- `quote-submitted`
- `quote-viewed` (opening the comparison)
- `quote-accepted`
- `quote-rejected` (not selected)
- `quote-declined`
- `work-started`
- `work-completed`
- `invoice-submitted`
- `job-completed`

**Where they go:**
- Every event passes `ContractorStore.emit()`, which calls `CommercialPolicy.evaluate()`. Today that is `NO_CHARGE_POLICY`, which always returns "not chargeable".
- The quote comparison shows the lifecycle, with the note "Nothing is charged".
- The contractor sees "Viewed by customer".

**Future revenue models** become policies over this stream, with no workflow change. None is implemented:
- **A:** customer subscription with unlimited quote requests
- **B:** contractor subscription
- **C:** lead fee
- **D:** transaction fee
- **E:** hybrid usage
- **F:** enterprise unlimited

## 6. Screens

| Product | Screen | Route |
|---|---|---|
| Humo PM | Request quotes through Humo | `/maintenance/:ref/quote-request` |
| Humo PM | Compare quotes (workflow, comparison, lifecycle) | `/maintenance/:ref/quotes` |
| Humo PM | Job › Next step: "Request quotes through Humo" / "Compare quotes" banner | `/maintenance/:ref` |
| Humo PM | Supplier › "On Humo Contractor" panel + Endorse | `/suppliers/:id` |
| Humo Contractor | Dashboard (open requests, active jobs, completed, rating, endorsements, verification; waiting for your quote; quotes sent; today and coming up; reputation; compliance) | `/contractor` |
| Humo Contractor | Quote requests / Jobs | `/contractor/requests`, `/contractor/jobs` |
| Humo Contractor | Quote request (job detail, protected contact, quote form, decline) | `/contractor/requests/:id` |
| Humo Contractor | Business profile (reputation, verification levels, services, areas, compliance, endorsements) | `/contractor/profile` |

The contractor shell has its own look: a charcoal bar, a teal accent, job-first navigation and bottom tabs on phones.

## 7. Intentionally NOT implemented

**Marketplace features:**
- No public directory, search engine, lead marketplace or bidding marketplace.
- No contractor advertising.
- No suggesting contractors the agency doesn't already know.
- No automated contractor selection.

**Money:**
- No payments, commission engine or transaction or lead fees.
- No pricing.

**Not built yet** (placeholders or toasts only):
- contractor self-registration and onboarding
- the Humo verification workflow (the states are represented only)
- real messaging and contact masking
- email invitations
- uploading photos and evidence
- contractor-submitted invoices
- editing services, areas and documents
- ratings capture

## 8. Evolving into standalone Humo Contractor

- **Service extraction:** move `domain/contractor`, `mock/contractor`, `features/contractor-portal` and `features/contractor-shared` into their own app and service. Humo PM keeps only the `ContractorNetwork` client and the job hand-off.
- **Separate API:** replace the mock adapters with HTTP clients against a Contractor API. The ports already describe its surface.
- **Integration events:**
  - Humo PM publishes job stage changes (work order issued, started, completed, invoiced, paid).
  - Humo Contractor publishes quote events.
  - This replaces today's mock join.
- **Other customers:** `QuoteRequest.customerId` and `source.product` let other Humo products, or non-PM customers, request quotes later.
- **Discovery:** `ContractorQuery` plus verification and reputation data support it if, and when, Humo decides to offer it.

## 9. Architecture concerns ⚑

1. **Accept is three calls today:** link supplier → record on the job → close the request. These need to become one server-side transaction or saga (with compensation) in the backend.
2. **Two vetting views:**
   - Humo-wide verification (Humo checks once).
   - The agency's own vetting (the bank letter, the agency's document checks).
   - **Decision needed:** should agencies be able to trust Humo verification for some documents?
3. **Reputation integrity.** Endorsements and ratings must be tied to completed, paid work, with anti-gaming rules: one endorsement per customer, revocable, and moderated.
4. **POPIA:**
   - Contact disclosure rules, data sharing between agency and contractor, and contractors seeing resident details after acceptance all need a legal review.
   - Humo's role is operator or responsible party, and that needs settling too.
5. **The Agency Administrator can still assign the "Contractor / Supplier" role** in Users & access. That should become an invitation to the business's own Humo Contractor identity.
6. **Initial bundle size:** the prototype's mock stores load at start-up, so the warning budget was raised to 1.2 MB. This disappears when mocks are replaced by the API.
