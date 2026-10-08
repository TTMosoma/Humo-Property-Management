# Document & PDF rendering standard

The rules every Humo document layout follows. They were worked out on the levy statement (`features/documents/levy-statement/`) and verified with headless Chromium on:
- the September 2026 Protea Gardens unit 1 statement;
- the same statement with 30 extra transaction rows;
- the same statement with every amount set to R 1 234 567.89.

**Goal:** the HTML is already a finished A4 document. Screen, browser print and the future Chromium PDF service all show the same document.

## 1. Page

- **A4, set by the document:** `@page { size: A4; margin: 14mm; }`. Without it, Chromium uses Letter.
- **14 mm margins.** That leaves 182 mm (about 688 CSS px) of content width, close to the white border the screen design already had.
- **No page furniture in `@page` margin boxes.** No page numbers and no "account · period" footers: the document contains only the document. Page numbers, if ever wanted, are added by the PDF service.
- **No height-dependent layout in print.** `min-height: 297mm` is screen-only, otherwise it forces an extra page.

## 2. One layout, not two

- **The document is drawn the same way everywhere.** On screen, in print and in PDF it's the same HTML and CSS: the sheet is `width: 210mm` with the page margins as padding, so lines wrap in the same places.
- **Responsive breakpoints are `@media screen and (max-width: …)`.** A plain `(max-width: 760px)` also matches a printed A4 page (about 720 px wide), and that was what stacked the printed statement before.
- **Print CSS only removes what isn't the document:**
  - the app chrome (`styles.scss`);
  - the sheet's own padding, because the page margin replaces it;
  - the shadow, border and rounded corners, which are screen-only.
- **Phones** (screen only) may reflow the sheet: stacked letterhead, 2-column summary, tighter table. That's a viewer adaptation; the PDF viewer will replace it later.

## 3. Page breaks

| Rule | Why |
|---|---|
| `break-inside: avoid` on the letterhead, parties, summary and the closing block | Logical blocks move to the next page whole. |
| Payment instructions **and** footer wrapped in one `.closing` block | "Amount due" is never stranded alone on the next page. |
| `break-after: avoid` on the letterhead | The header never ends a page alone. |
| `tr { break-inside: avoid }` | A transaction row never splits. |
| `thead { display: table-header-group }` | Column headings repeat on every page. |
| `tfoot { display: table-row-group; break-before: avoid }` | Browsers repeat `<tfoot>` on every page; the closing balance must appear once, after the last row. |

**Known limit:** CSS can't pull the last rows over with a block that moves to the next page. A short final page holding only the payment block is correct behaviour, not a bug.

## 4. Tables and amounts

- **Dates and amounts never wrap** (`white-space: nowrap`); the description column takes the remaining width. Amounts use non-breaking spaces (`R 1 234 567.89`).
- **Six summary figures sit three across in two rows.** Six across at A4 width leaves about 110 px per box and clips amounts of R 100 000 and up.
- **Test with large values.** Every layout is tested with R 1 234 567.89 in every amount and with a 30-row transaction list.
- **Don't shrink text to fit.** A readable two-page document beats a cramped one-page document.

## 5. Colour, fonts and branding

- **Colours print regardless of settings.** Set `print-color-adjust: exact` on the sheet; without it, browsers drop backgrounds by default and white "Amount due" text vanishes.
- **The sheet is always white**, even in dark mode. Document colours are fixed values or the branding variables (`--doc-primary`, `--doc-accent`), never app theme tokens.
- **Fonts come from the approved list** (`DOCUMENT_FONTS`), which must be installed wherever the PDF is rendered.
- **Branding enters only through the resolved branding:**
  - CSS custom properties and the font stack set on the sheet;
  - never by injecting styles or markup.

## 6. Content rules

- **All data comes from data:**
  - agency name, contact details and footer line from the organisation's document settings;
  - bank details from the scheme's trust account;
  - names, numbers and amounts from the document's read model.

  Templates contain no hard-coded business values.
- **Template text is plain text.** Title, footer and legal text are bound and escaped, never inserted as HTML.
- **Transactions always show.** A design may hide the summary, payment or queries section, but not the transactions.

## 7. Browser print (today)

- **How users get a PDF now.** *Print or save PDF* calls `window.print()`, which prints the same document.
- **Chrome's print dialog may add its own header and footer:** date and time, page title, URL and page count. They come from the browser's *Headers and footers* setting, which a page cannot change. With it unticked, or with *Save as PDF*, the output contains only the document.
- **Printer drivers can change the paper.** Printing to a printer driver (e.g. *Microsoft Print to PDF*) uses the printer's paper size and can ignore A4.
- **This is why the PDF service exists** (§8).

## 8. Requirements for the Chromium PDF service (future)

- **Render the same layouts** with the same data, template version and resolved branding. One renderer, not a second PDF design.
- **Print settings:**
  - `preferCSSPageSize: true` (A4 from `@page`);
  - `printBackground: true`;
  - `displayHeaderFooter: false`.
- **Wait for readiness before printing:** data loaded and `document.fonts.ready`.
- **Store the bytes of issued documents.** Each render produces different bytes (Chromium embeds a creation date), so preview and download must use one stored render.
- **Fonts and assets are local** to the render host. No external requests.
- **Regression set for every layout change:**
  - normal statement;
  - 30 extra rows;
  - large amounts;
  - backgrounds off;
  - each available template.
