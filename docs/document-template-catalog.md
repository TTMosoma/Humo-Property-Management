# Document template catalogue

The initial catalogue: what exists, what's planned, and why each template exists. Seeded in `mock/db/seed-documents.ts`; managed in *Platform → Document templates*. Architecture: [document-template-architecture.md](document-template-architecture.md).

**Rule:** every template needs a reason to exist. Variations that only change a colour belong in branding, not in a new template.

## Status key

| Status | Meaning |
|---|---|
| **Active** | Usable by every customer whose plan includes its tier. |
| **Preview** | Usable early; may still change. |
| **Planned** | In the catalogue so the roadmap is visible. Never offered as usable; there's no layout to render yet. |
| **Deprecated** | No longer offered for new documents. Documents issued with it keep rendering. |

## Levy statement (first implemented document type)

| Template | Tier | Status | Version | Layout | Why it exists |
|---|---|---|---|---|---|
| **Standard** (`levy-statement.standard`) | Standard | Active | v1 | `levy-statement/classic`, Humo branding | Every customer gets a clear, correct statement without setting anything up. This is the A4 reference implementation. |
| **Professional** (`levy-statement.professional`) | Premium | Active | v1 | `levy-statement/branded`, agency branding | Agencies want owners to recognise statements as theirs: their wordmark, colours and font. |
| **Executive** (`levy-statement.executive`) | Premium | Planned | — | (not built) | Larger schemes and trustees ask for the trend: 12-month balance and arrears ageing panel. |
| **Enterprise custom** (one per organisation, e.g. `acacia.levy-statement`) | Enterprise custom | Active | Acacia v2 (v1 retired) | `levy-statement/branded`, template branding | The organisation's own colours, font, wording ("Statement of account"), numbered statements, footer and legal notice. |

**Seeded simulation data:**
- **Acacia** has a custom template on version 2. The entitlement comes from a time-boxed pilot override on its Professional subscription.
- **Generated customers:**
  - about 35% of Professional and Enterprise customers default to Professional;
  - about 30% of Enterprise customers have their own template.
- **All seeded statements** were issued with Standard v1.

## Meeting notice and minutes (Slice C)

| Template | Tier | Status | Version | Layout | Why it exists |
|---|---|---|---|---|---|
| **Notice: Standard** (`meeting-notice.standard`) | Standard | Active | v1 | `meeting-notice/classic` | Trustees and owners must get written notice with the agenda; this is a correct one with no setting up. |
| **Notice: Professional** (`meeting-notice.professional`) | Premium | Active | v1 | `meeting-notice/branded`, agency branding | Matches branded statements. |
| **Minutes: Standard** (`meeting-minutes.standard`) | Standard | Active | v1 | `meeting-minutes/classic` | The scheme's formal record of decisions: attendance, quorum, minutes, resolutions with votes, actions. |
| **Minutes: Professional** (`meeting-minutes.professional`) | Premium | Active | v1 | `meeting-minutes/branded`, agency branding | Matches the agency's other documents. |

The meeting records the version a notice was sent with and the version minutes were approved with (`docs/10-governance.md`).

## Planned document types

| Document type | Standard | Professional | Notes |
|---|---|---|---|
| Invoice | Planned | Planned | Ad-hoc charges; needs tax-compliant fields. |
| Receipt | Planned | Planned | Proof of payment with allocation. |
| Maintenance work order | Planned | Planned | Professional adds the agency's conditions of appointment. |
| Owner statement | — | — | Type defined, no templates yet. |
| Payment notice | — | — | Reminders and letters of demand from credit control. |
| Contractor quote | — | — | As approved through Humo Contractor. |
| Trustee resolution | — | — | Resolutions print inside the minutes for now. |
| Financial report | — | — | Income statement, balance sheet, levy roll. |

## Commercial packaging (entitlements, not prices)

| Package / add-on | Templates & branding it brings |
|---|---|
| Humo Essentials | Standard templates; contact details on documents |
| Humo Professional | + Premium templates (`document-templates-premium`), document branding (`document-branding`) |
| Humo Enterprise | + Enterprise custom templates (`document-templates-custom`) |
| **Document & Branding Pack** (add-on) | Premium templates + document branding, for customers on Essentials |
| Per-customer override | Any of the above, time-boxed (e.g. Acacia's custom statement pilot) |

## Adding a template

1. **New design of an existing layout** (e.g. a "Detailed" levy statement that shows more lines): add a catalogue entry with a `TemplateDesign`. No code.
2. **New layout:**
   - Add a `TemplateLayout` key and a layout component that meets the [rendering standard](document-pdf-rendering-standard.md).
   - Publish the template as *Preview* first.
3. **New document type:**
   - Add it to `DOCUMENT_TYPES` with `implemented: true`.
   - Add a `DocumentData` case in `DocumentRenderer` and its layout.
   - Add a Standard template marked `isDefault`.
