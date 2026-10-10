# Document and PDF audit

**What was checked:**
- **Code:** `features/documents/**`, `core/documents/document-templates.service.ts`, `domain/models/document.ts`.
- **Docs:** `docs/document-pdf-rendering-standard.md`, `docs/document-template-architecture.md`, `docs/document-template-catalog.md`.
- **Browser:** the KC-042 October 2026 statement as on-screen HTML (W6).

**Not checked in this audit:**
- printing;
- "Save as PDF" output;
- long-content page breaks;
- phone rendering.

The rendering standard says those were verified with headless Chromium when the statement was built. That evidence wasn't reproduced here.

## 1. Current rendering approach (observed)

| Aspect | Implementation | Status |
|---|---|---|
| **Renderer** | One Angular component, `DocumentRenderer`, combines document type, resolved template version, data read model and branding into an A4 HTML "sheet". The comment and `docs/document-template-architecture.md` describe this as the seam a .NET + Chromium renderer will mirror. | Implemented |
| **Rendered types** | 4 of 11 `DocumentType`s: **levy statement, meeting notice, meeting minutes, payment notice** (reminders, final demand, letter of demand). | Implemented |
| **Defined but not rendered** | invoice, receipt, owner statement, work order, contractor quote, trustee resolution, financial report: *Planned* in the catalogue, never offered as usable. | Planned |
| **Print and download** | `window.print()` on the statement, collection letter, meeting notice and minutes, and reports. **No PDF generation**; users "Save as PDF" in the browser. No jsPDF or html2canvas (as decided). | Implemented (browser print only) |
| **Page model** | `@page { size: A4; margin: 14mm }`; the sheet is 210 mm wide on screen; print CSS strips app chrome; `print-color-adjust: exact`; break rules for letterhead, summary, closing block and table rows; repeating `thead`; `tfoot` rendered once. | Implemented (`document-sheet.scss`) |
| **Long content** | The standard says it was tested with 30 extra rows and R 1 234 567.89 amounts; amounts and dates `nowrap`. | Implemented; **not re-verified here** |
| **Branding source** | `OrganisationDocumentSettings` (Settings › Documents & templates): wordmark, colours, font from an approved list, footer and legal text; branding changes need step-up. Agency name and contact details come from the document settings; **bank details from the scheme's trust account** (`MockDb.trustAccount`); amounts from the statement read model. | Verified (sim) W6: Acacia letterhead, FNB trust account, KC-042 reference |
| **Template selection** | A default per document type per organisation; tiers Standard, Premium (`document-templates-premium`) and Enterprise custom (`document-templates-custom`), gated by entitlement; Acacia has a custom levy statement on v2 through a time-boxed pilot override. | Implemented, not verified (this audit) |
| **Versioning** | Templates have published versions; documents record the template **version** they were issued with (meeting notice and minutes, collection letters, statements via `issued`), so historical documents re-render with their original version. | Implemented (by design and code) |
| **Screen versus output** | The same HTML and CSS for screen and print; screen-only `min-height`; responsive changes are restricted to `@media screen`. Differences are browser print headers and footers (user setting) and printer-driver paper size. Both are documented. | Documented limits |

## 2. Gaps and risks

| ID | Finding | Evidence | Severity |
|---|---|---|---|
| F-15 | Statement **email** and **re-send** from the statement and account pages are toasts; they don't record a Sent message or an issued document, unlike *Send statements* in the billing run. | `statement-page.ts:133`, `account-page.ts:170` | Medium |
| F-43 | **No server-rendered PDF.** Owners receiving a statement by email need an attached or linked PDF; today only browser print exists. | Rendering standard §7–8 | High for go-live; expected (planned) |
| F-44 | **"Issued document" isn't an immutable artefact.** Only the template version is recorded at issue (`recordStatement`). `statement()` rebuilds a past period from the **current** ledger, **current** account holder and **current** trust account (`payTo: this.trustAccount(scheme)`). A back-dated journal, a change of owner or a change of bank details therefore changes previously issued statements. | `mock-db.ts:278–295`, `:683` | High (backend design): store the issued PDF, or a snapshot plus a hash |
| F-36 | Uploaded documents (library) aren't persisted beyond the browser session (object URLs). | `library-store.ts` | Simulation only; the backend needs object storage, virus scan and size limits (Settings › System holds an upload limit) |
| F-46 | Fonts: `DOCUMENT_FONTS` must be installed in the PDF renderer's environment, or output will differ. | Standard §5 | Medium (backend operations) |
| F-47 | The rule book shared from Scheme rules is a generated **HTML** file, not a rendered template document type. | `rules-store.ts` `ruleBookHtml` | Low (consistency) |

## 3. Requirements for consistent future PDF generation

These are drawn from existing docs and code, not new requirements.

1. **One renderer.**
   - The backend renders the same layouts (the HTML and CSS that the Angular components produce today, ported or server-side rendered) with headless Chromium.
   - Settings: `preferCSSPageSize`, `printBackground: true`, `displayHeaderFooter: false`.
   - (Rendering standard §8.)
2. **Inputs are versioned:** template id and version, branding snapshot, data read model, locale and timezone (Africa/Johannesburg), approved fonts.
3. **Issued documents are immutable:**
   - store the PDF, or the exact inputs plus a content hash, at issue time;
   - re-render only for preview;
   - link issued documents to Sent messages and the account timeline.
4. **Entitlement and permission checks at render time:** a template tier must be entitled at issue; historical documents always render with their version.
5. **A regression set:**
   - the statement with 30 rows;
   - the statement with large amounts;
   - minutes with many resolutions;
   - a letter of demand;
   - each in Standard, Professional and custom.

   Compare PDF page count and visual snapshots.
6. **Accessibility of PDFs** (tagged PDF, language, reading order) is **unresolved**; a product decision is needed.

## 4. Decisions required

| # | Decision |
|---|---|
| D7 | Is the issued statement the stored PDF (immutable), or re-rendered on demand from a snapshot? |
| D8 | Rendering technology: Chromium (Puppeteer or Playwright) in .NET (e.g. PuppeteerSharp), a separate render service, or a commercial engine? |
| D9 | Delivery: attach the PDF to email, or a secure link to the resident portal (POPIA consideration)? |
| D10 | Statement numbering (custom templates show numbered statements): per scheme, per agency, gapless? |
