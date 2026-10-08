# Document & template architecture

Status: **frontend implemented, backend designed** (October 2026). The levy statement is the first document on this architecture. Every other document type is in the catalogue as *planned*.

Related:
- [document-template-catalog.md](document-template-catalog.md): the templates that exist.
- [document-pdf-rendering-standard.md](document-pdf-rendering-standard.md): how a template must render on A4.

## 1. The model

```
Document = Document type + Data + Template @ Version + Resolved branding  →  HTML/CSS (A4)  →  (later) Chromium  →  PDF bytes
```

| Concept | What it is | Where |
|---|---|---|
| **Document type** | What a document *is*: levy statement, invoice, receipt, work order… Fixed by Humo. | `DOCUMENT_TYPES` in `domain/models/document.ts` |
| **Template** | How a type *looks*. One type has several templates (Standard, Professional, an organisation's own). | `DocumentTemplate` |
| **Template version** | An immutable snapshot of a template's design. New documents use the current version; old documents keep theirs. | `TemplateVersion` |
| **Design** | The structured, validated part of a version: layout, branding mode, palette, font, sections, wording, legal text, number prefix. | `TemplateDesign` |
| **Layout** | Humo's own HTML/CSS that draws a design. The only code that renders anything. | `levy-statement/classic`, `levy-statement/branded` |
| **Tier** | How a template is sold: Standard, Premium or Enterprise custom. Each tier maps to **one entitlement**. | `TEMPLATE_TIERS` |
| **Status** | Planned → Preview → Active → Deprecated. Only preview and active can be used. | `TemplateStatus` |
| **Branding** | Humo defaults, the agency's branding, or the template's own. | `resolveBranding()` |
| **Data** | The document's facts (statement, account, scheme, trust account), from the API. Never part of a template. | `StatementView` |

**Document type ≠ template.** A levy statement is always a levy statement. The agency only chooses how it's laid out.

## 2. Frontend structure

```
domain/models/document.ts            types, tiers, statuses, availability rule, branding hierarchy, design validation
domain/ports/document-data-sources.ts DocumentTemplateDataSource (customer), PlatformTemplateDataSource (Humo)
core/documents/document-templates.service.ts   the registry: forType(), defaultFor(), resolve(), brandingFor()
features/documents/
  document-renderer.ts               DocumentRenderer: type + template@version + data → layout component
  levy-statement/levy-statement-document.*      the levy statement layouts (classic, branded)
  template-picker.ts                 reusable selector: available / locked / planned
  documents-settings-page.*          Settings → Documents & templates
  document-forms.ts                  default template, contact & branding, publish custom version, platform forms
features/accounts/statement-page.*   the statement screen: as issued, or preview another template
features/platform/document-templates-page.ts   Humo: catalogue, versions, adoption
mock/db/document-store.ts, seed-documents.ts   simulated tables (development / simulation only)
mock/data-sources/in-memory-document-data-sources.ts   simulated API with its rules
```

**The registry question.** Every document screen asks one thing:

> `registry.forType('levy-statement')` → the templates this organisation may use.

The filter is `templateAvailability(template, entitlements)`. It reads only the template's status and its tier's entitlement. The API applies the same rule when it generates a document.

**The renderer seam.** `StatementPage` no longer draws the statement itself. It gives `DocumentRenderer`:
- the document data;
- a resolved template version;
- the organisation's settings.

A new document type adds a `DocumentData` case and a layout component. Screens don't change shape.

## 3. Tiers and entitlements

Template access comes from entitlements, never package names:

| Tier | Entitlement | Comes from (catalogue data, not code) |
|---|---|---|
| Standard | none | every customer |
| Premium | `document-templates-premium` | Humo Professional, or the **Document & Branding Pack** add-on |
| Enterprise custom | `document-templates-custom` | Humo Enterprise, or a per-customer override (e.g. Acacia's pilot) |
| Branding (logo, colours, font) | `document-branding` | Humo Professional, or the Document & Branding Pack |

- **What decides access.** Packages, add-ons and overrides only decide which entitlements a customer has. No screen asks "is this customer Enterprise?".
- **Locked templates.** They are shown, never broken. The card says what the template does and what it's available with ("Available with Enterprise."), worked out from the catalogue. It links to *Plan & features* (`/settings/plan?feature=…`).
- **Pricing.** None in the UI.

## 4. Permissions (who can do what)

Identity → role → permissions → scope → entitlements → context → audit.

| Who | Can | Permission |
|---|---|---|
| Agency Administrator | See templates, set defaults, edit contact details & branding, publish custom versions | `Documents.Configure` (plus the entitlement) |
| Portfolio Manager, Finance, other staff | Use templates their plan includes: preview any statement in any available template | `Accounts.View` |
| Owners | See their statement **as issued**, never a preview | `Account.ViewOwn` |
| Humo Account Manager | Grant template entitlements (subscription overrides/add-ons), set up a customer's custom template | `Platform.Subscriptions.Manage`, `Platform.Customers.Manage` |
| Humo System Administrator | Move platform templates through their lifecycle | `Platform.Templates.Manage` |
| Humo Executive | Read template adoption (premium defaults, custom templates); no changes | `Platform.View` |

Every change goes through the API's command pipeline. In the simulation that's `MockGateway`:
1. Observe-mode check.
2. Permission.
3. Entitlement.
4. Version (409).
5. Validation (422).
6. Audit.

## 5. Branding hierarchy

```
Humo defaults  →  Agency branding  →  Enterprise template design  →  (document overrides: none)
```

- **Humo defaults.** Used by the Standard template, always.
- **Agency branding.** Logo, palette and font in `OrganisationDocumentSettings.branding`. Used by templates in `agency` branding mode (Professional), only while the agency holds `document-branding`.
- **Enterprise template design.** The custom template's own palette, font, wording, legal text and number prefix (`brandingMode: 'template'`).
- **Documents can't override branding.** Per-document styling would make an agency's documents inconsistent and unmanageable.

**Contact details** (email, phone, footer line) belong to every customer. They are document data, not a premium feature.

**Bank details belong to the scheme.** Each scheme has its own trust account, so payment details come with the statement data (`StatementView.payTo`), never from a template.

## 6. Multi-scheme and multi-tenant context

- **Context comes from data.** A document's context (agency → scheme → unit → account) comes from its data and the signed-in organisation. Templates never contain an agency name, phone number, email, scheme name, bank details or account number.
- **Placeholders replaced.** The values that were hard-coded during the A4 experiment are gone:
  - The agency email and phone now come from document settings.
  - The bank details now come from the scheme's trust account. These are simulated per scheme in `trustAccountFor()`.
- **Custom templates are tenant-owned** (`organisationId`). The API never returns another organisation's custom template.
- **Defaults are per organisation**, in `OrganisationDocumentSettings.defaults`.

## 7. Enterprise customisation, safely

An Enterprise custom template is **data**, never code. The whole surface is `TemplateDesign`:

| Can change | How it's constrained |
|---|---|
| Colours | `#rrggbb` only |
| Font | From an approved list (installed in the app and on the renderer) |
| Sections | From a fixed list: summary, how to pay, queries. They can be shown or hidden; transactions are always shown. |
| Title (terminology) | Plain text, 60 characters |
| Footer text, legal notice | Plain text, 400 characters |
| Document number prefix | 2–8 capital letters or digits |

- **No customer HTML, CSS or script.** None is accepted, stored or executed. Text is bound by Angular (escaped) and will be escaped by the server renderer too.
- **Validation lives in one place.** `validateDesign()` holds the rules the API applies; the client shows the same messages next to the fields.
- **Later options stay structured.** A drag-and-drop designer is a future product capability. Section order, a header style or a second layout would all be new structured fields on `TemplateDesign`, never free-form markup.

## 8. Versions and historical documents

- **Publishing never edits a version in place.** Publishing a custom template creates a new version and keeps the earlier ones (retired, still renderable).
- **A document records its template.** Every generated document stores `issuedWith: { templateId, version }`.
- **Rendering uses that version.** A statement sent in September with *Professional v3* renders with v3 after Professional becomes v4, and after the agency changes its default.

In the frontend today:
- The statement screen opens **as issued**. It shows "Template: Standard · v1 · as issued" and the current default for new statements.
- Staff can preview another template with the same figures. The screen labels it a preview, and nothing that was sent changes.
- Settings shows the custom template's version history, and any version can be previewed (`?template=…&v=…`).

**Not built yet:**
- **Storing generated PDFs.** Historical PDFs will be stored by the backend (see §10). Until then the frontend re-renders from the recorded version.
- **Platform template versions.** Humo's own templates are versioned in data. Their layouts are versioned with the app; a v2 of *Standard* ships as a new layout key.

## 9. Template selection UX

- **On a document.** A *Template* bar above the document shows the template and version, and whether it's as issued or a preview. *Preview another template* opens the shared `TemplatePicker`:
  - available templates can be chosen;
  - locked ones explain how to get them;
  - planned ones are hidden.
- **In Settings → Documents & templates:**
  - the default per document type (types that aren't built say *Coming later*);
  - the levy statement templates, where choosing one previews it on a real statement;
  - contact details and branding (locked without `document-branding`);
  - the organisation's custom template with its versions (locked without `document-templates-custom`).
- **In Humo's console**, *Platform → Document templates*:
  - the catalogue across customers, with status, current version, defaults and entitled customers;
  - status changes (system admin);
  - setting up a customer's custom template (account manager).

## 10. The backend this prepares for (not implemented)

```
Angular ──POST /documents/{type}/{id}/render──▶ .NET Document Service
                                                  │ Template resolver: issuedWith (or default) → template version → design
                                                  │ Branding resolver: the hierarchy in §5
                                                  │ Data: the document's read model (e.g. StatementView)
                                                  ▼
                                    HTML + CSS (the same layouts, server-rendered)
                                                  ▼
                                    Chromium (Playwright / PuppeteerSharp), A4, no browser header/footer
                                                  ▼
                                    PDF bytes ──(stored for issued documents, keyed by document + version)
                                                  ▼
Angular ◀──────────────── application/pdf ────────┘
   ├── Preview: <iframe [src]="objectUrl">     ← the same Blob
   └── Download: <a [href]="objectUrl" download>
```

- **One PDF.** Preview and download use the same bytes. Chromium stamps a creation date into each PDF, so the API renders once and serves the stored file for issued documents.
- **Same rules as the UI.** The service refuses templates the organisation can't use, using the same availability rule.
- **Seams that already exist:**
  - `DocumentRenderer`: swap the component for a PDF viewer when bytes are available.
  - `DocumentTemplateDataSource`: an HTTP implementation replaces the mock.
- **Template assets.** Fonts in `DOCUMENT_FONTS` must be installed on the render host. Image logos need an asset store; the simulation uses a wordmark.

## 11. Security considerations

- **No customer HTML, CSS or script.** Designs are validated data. Free text is escaped in the browser and must be escaped by the server renderer too.
- **The renderer runs isolated** from customer input:
  - no network access except Humo's own asset host;
  - JavaScript disabled for document pages, unless a layout needs it.
- **Tenant isolation:**
  - custom templates and settings are filtered by organisation on every read;
  - templates and settings can only be written by that organisation's administrators, or by Humo staff with platform permissions.
- **Entitlements are checked server-side.** That happens when settings change and again when a document is generated: hiding a locked template in the UI protects nothing by itself.
- **Every change is audited**: defaults, branding, published versions, status changes and custom template set-ups, with actor, role and organisation.
- **Optimistic concurrency.** Template and settings changes carry `version` and get a 409 if someone changed them first.
