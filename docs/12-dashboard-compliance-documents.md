# 12 — Dashboard, Compliance and Documents (Checkpoint 7)

Status: **implemented in the frontend simulation** (October 2026).

Three parts, built in order because each reads the one before:

- **Documents** (review finding F20): documents are born in context. An Attachments panel (pattern P5) sits on every record, and the library is a search over all of them.
- **Compliance** (F22): items are generated from the records other modules keep, shown as a schemes × obligations matrix.
- **Dashboard** (F9): action-led. Today's work, what changed since yesterday, and scheme health worked out from live data instead of fixture figures.

## 1. Documents

| Concept | What it is | Where |
|---|---|---|
| **Document** | A file with a title, category, visibility, optional expiry and the record(s) it belongs to | `LibraryDocument` in `domain/models/library.ts` |
| **Record link** | Scheme, unit, person, supplier, job or meeting. The first link is where it was uploaded. The API works out the schemes it belongs to: a supplier's documents belong to every scheme it serves. | `RecordLink`, `LibraryDocument.schemeIds` |
| **Visibility** | Staff only · Staff and trustees · Owners of the scheme · This unit's owner and tenant (unit documents only) | `DocumentVisibility` |
| **Expiry** | Expiring = within 30 days. Insurance, certificates and vetting documents carry one, and Compliance reads it. | `expiryState()` |
| **Compliance link** | A scheme document can be evidence for building insurance, fire equipment, lift inspection or audited financial statements | `LibraryDocument.compliance` |
| **Vetting link** | A supplier document can be one of its vetting documents. Uploading it updates the supplier's vetting record, so Suppliers, work orders and Compliance all see the new expiry. | `LibraryDocument.supplierDoc` |

**Rules the API enforces** (`LibraryStore.checkUpload()` / `check()`, through `MockGateway` with `Documents.Manage` and the `documents` entitlement):

- **Basics:** a file is required; up to 25 MB; needs a title.
- **Expiry dates:** evidence for Compliance, and vetting documents other than a bank letter, need an expiry date.
- **Where things are uploaded:**
  - compliance documents on the scheme;
  - vetting documents on the supplier;
  - "This unit only" on a unit.
- **Replacing:** uploading a new document for the same obligation on the same record archives the old one ("Replaced by …").
- **Archive and restore:** archiving needs a reason; restoring brings the document back.

**Screens**

| Screen | What |
|---|---|
| **Attachments panel**: on units, people, suppliers, jobs and meetings ("Papers & attachments") | The record's documents with category, visibility and expiry; *Upload*; archived ones on request; *Open in the library*. On a supplier, each vetting document row also has *Upload*. |
| **Documents** (`/documents`), also each scheme's *Documents* tab with *Upload to (scheme)* | Current · Expiring or expired · Archived. Search, plus filters by category, record type, visibility and scheme. `?record=kind:id` shows one record's documents. |
| **Document** (`/documents/:id`) | Details, the records it belongs to, what it's evidence for, *Edit details*, *Archive* / *Restore*, *Upload a newer one*. |

**Files aren't stored in the prototype.** It keeps a document's details only. A file chosen in this session opens until the page reloads (an object URL); seeded documents are metadata only. The API will store and serve files (`GET /documents/{id}/content`).

**New permission:** `Documents.Manage` (Agency Administrator, Portfolio Manager, Finance, Operations).

## 2. Compliance

| Obligation | Comes from | Complete when | Due |
|---|---|---|---|
| **AGM** | The scheme's financial year-end + Governance meetings | An AGM after the year-end has notice sent (or is held), or it's recorded as held outside Humo | 4 months after the year-end; notice 14 days before |
| **Audited financial statements** | The financial year-end | The statements are uploaded as evidence, or the sign-off is recorded | 4 months after the year-end |
| **CSOS annual return** | The financial year-end | The submission is recorded with its reference | 4 months after the year-end |
| **Building insurance** | The policy in Documents | A current policy is on file | Its expiry |
| **Fire equipment service** | The certificate in Documents | A current certificate is on file | Its expiry |
| **Lift inspection** | The certificate in Documents, for schemes with lifts (otherwise N/A) | A current certificate is on file | Its expiry |
| **Supplier documents** | The vetting documents of suppliers who worked at the scheme in the last 12 months | Each has a current COIDA letter and public liability insurance (the site-work documents) | The earliest expiry |
| **Manual items** | Added by the team | Marked as done with a note | Their date |

- **Statuses:** Complete · Upcoming (not yet due) · Due soon (within 30 days) · Overdue · N/A.
- **Neutral wording.** The page states that Humo tracks deadlines and makes no claim of legal sufficiency.
- **Prototype defaults:** the 4-month deadline and 14 days' notice. They will be set per scheme.
- **Scheme facts it needs:** each scheme's financial year-end and whether it has lifts (`ComplianceProfile`).

**Tasks.** `ComplianceStore` keeps the Attention model in step:
- **One Task per item that's due soon or overdue,** for the scheme's portfolio manager, closed by Humo when the item completes.
- **Supplier documents get one Task per supplier,** whichever schemes it affects. The work is getting that supplier's new certificate.
- **A Task closed by a person isn't recreated for 30 days.** One closed by Humo comes back when the item is due again (next year's AGM, for instance).
- **Fixture ids kept:** the old fixture Tasks w23–w27 keep their ids (`CMP-JH-INS`, `CMP-KC-AGM`, `CMP-SLM-CSOS`, `DOC-RAND-PLUMBING`, `CMP-BDE-FIRE`).

**Screens**

| Screen | What |
|---|---|
| **Compliance** (`/compliance`) | Summary (Overdue · Due within 30 days · Upcoming · Complete); **Matrix** of schemes × obligations, worst schemes first, each cell linking to its item; Due & overdue · Upcoming · Complete · All lists; *Add item* (`Compliance.Manage`). Also each scheme's *Compliance* tab, as a list. |
| **Compliance item** (`/compliance/:id`) | Status and what it's based on; the one next step: *Upload the new policy*, *Schedule the AGM* (opens the meeting form as an AGM), *Record the submission*, *Open the supplier*, or *Mark as done*; evidence; documents; previous years; where it comes from. |

**New:** permission `Compliance.Manage` (Agency Administrator, Portfolio Manager). **Compliance add-on** (`compliance` feature), which Acacia now has in the seed; Enterprise still includes it.

## 3. Dashboard and scheme health

**Scheme health is computed** (`InMemorySchemeDataSource.health()`), no longer read from `fixtures/scheme-health.ts`. That fixture is now only the seed's target figures for generating ledgers and jobs.

| Vital sign | From |
|---|---|
| Arrears, accounts 90+ days | The levy accounts' ageing |
| Collected (3 months) | 1 − unpaid from the last 3 months ÷ 3 months' charges. An approximation: the API will use billed vs received. |
| Open / overdue jobs | Maintenance |
| Compliance | The worst generated item. A supplier's lapsed certificate counts at most as "due soon": the supplier has its own Task. |
| Next meeting | Governance |
| Rating | `rateHealth()`, moved to the domain |

**Dashboard** (staff):
1. **A small strip:** schemes, units, monthly levy roll, collected %, arrears. Totals don't lead.
2. **Today:** the person's work grouped as Overdue · Due today · This week, next to the actionable tiles. The Compliance tile now counts the schemes' items due, not Tasks visible to the person.
3. **Since yesterday:** what changed in the last 24 hours.
   - New approvals, maintenance requests and quotes received.
   - Payments received (to allocate).
   - Compliance items that went overdue or became due.
   - Documents uploaded, notices sent and minutes approved.
   - Billing posted, and collection steps that fell due.
   - From `SchemeDataSource.changes(schemeIds, since)`; the API will serve it from its event log.
4. **Portfolio health:** a sortable table of every scheme in scope with the reasons it needs attention.
5. **Team workload** (Agency Administrator): open and overdue Tasks per person.

Trustees keep their one-scheme card. Their Today and Since yesterday lists cover only their scheme.

## 4. Walkthrough

1. **Reset the simulation** (prototype toolbar), then sign in as **Johan van der Merwe** (Portfolio Manager).
2. **Dashboard:**
   - **Today:** Bright Spark's lapsed insurance is at the top.
   - **Since yesterday:** quotes received, a collection step due.
   - **Portfolio health:** Kingfisher Court is at risk (collections and an overdue job), and its AGM is due.
3. **Compliance › Matrix.** Open **Kingfisher Court › AGM** → *Schedule the AGM*. On the meeting, *Send notice*. Back on Compliance the AGM is complete and its Task is closed.
4. **Suppliers › Bright Spark Electrical.** On *Public liability insurance*, choose *Upload*, give the new expiry, and upload. The vetting row turns valid, the Suppliers column clears and the Task closes.
5. **As Thandeka (Agency Administrator):**
   - **Jacaranda Heights › Insurance** → *Upload the new policy*; the old policy is archived as replaced.
   - **Documents › Archived** to see it.
   - **Dashboard** → Team workload.
6. **As Sipho (Trustee):** Kingfisher Court's card, and only his scheme's changes.

## 5. Known gaps

- **File storage.** Files are not stored or served; there's no virus scan and no versioned file history.
- **Visibility.** Visibility is recorded, but the resident and trustee document views come in Checkpoint 8.
- **Compliance rules.** Prototype defaults that will be set per scheme. The financial year-end and lifts aren't editable yet (Settings).
- **Changes since yesterday.** Derived from timestamps on the records. The API needs an event log, for example for "accounts that crossed 90 days".
- **Bundle size.** The initial bundle is 1.21 MB, over the 1.2 MB warning budget, because the simulated stores start at launch. It won't apply with the HTTP data layer.
