import { EntitlementSet, Feature } from './entitlement';

/**
 * Humo documents: what a document IS (its type) is separate from how it LOOKS
 * (its template). A levy statement is always a levy statement; an agency picks
 * which template it is laid out with.
 *
 *   Document type → Templates → Versions → (entitlement filter) → Available templates
 *                                     ↓
 *   Document = type + data + template + version + resolved branding → HTML → (later) Chromium → PDF
 *
 * Templates are DATA, not code an organisation supplies: a template version
 * holds a structured, validated design (`TemplateDesign`) that one of Humo's
 * own layouts renders. No customer HTML, CSS or script is ever executed.
 * See docs/document-template-architecture.md.
 */

// ---------------------------------------------------------------- Document types

export type DocumentType =
  | 'levy-statement'
  | 'invoice'
  | 'receipt'
  | 'owner-statement'
  | 'payment-notice'
  | 'work-order'
  | 'contractor-quote'
  | 'meeting-minutes'
  | 'trustee-resolution'
  | 'meeting-notice'
  | 'financial-report';

export interface DocumentTypeDef {
  type: DocumentType;
  label: string;
  description: string;
  /** A Humo layout exists for it. Unimplemented types are listed, never offered as usable. */
  implemented: boolean;
}

export const DOCUMENT_TYPES: DocumentTypeDef[] = [
  { type: 'levy-statement', label: 'Levy statement', description: 'An owner’s monthly account: charges, payments, balance and how to pay.', implemented: true },
  { type: 'invoice', label: 'Invoice', description: 'A charge raised on an account outside the monthly levy.', implemented: false },
  { type: 'receipt', label: 'Receipt', description: 'Proof of a payment received and how it was allocated.', implemented: false },
  { type: 'owner-statement', label: 'Owner statement', description: 'An owner’s position across every unit they own.', implemented: false },
  { type: 'payment-notice', label: 'Payment notice', description: 'Reminders and letters of demand from credit control.', implemented: false },
  { type: 'work-order', label: 'Maintenance work order', description: 'The instruction a supplier works to, with scope and approval.', implemented: false },
  { type: 'contractor-quote', label: 'Contractor quote', description: 'A quote received through Humo Contractor, as approved.', implemented: false },
  { type: 'meeting-minutes', label: 'Meeting minutes', description: 'The record of a trustee meeting or AGM.', implemented: true },
  { type: 'trustee-resolution', label: 'Trustee resolution', description: 'A decision of the board, as signed.', implemented: false },
  { type: 'meeting-notice', label: 'Meeting notice', description: 'Notice of a trustee meeting, AGM or SGM, with the agenda.', implemented: true },
  { type: 'financial-report', label: 'Financial report', description: 'Income statement, balance sheet and levy roll for a scheme.', implemented: false },
];

export const DOCUMENT_TYPE_META: Record<DocumentType, DocumentTypeDef> = Object.fromEntries(DOCUMENT_TYPES.map((d) => [d.type, d])) as Record<
  DocumentType,
  DocumentTypeDef
>;

// ---------------------------------------------------------------- Tiers & entitlements

/** How a template is sold. A tier maps to one entitlement — never to a package name. */
export type TemplateTier = 'standard' | 'premium' | 'custom';

export interface TemplateTierDef {
  tier: TemplateTier;
  label: string;
  /** The entitlement that unlocks every template of this tier; null = every customer. */
  feature: Feature | null;
}

export const TEMPLATE_TIERS: Record<TemplateTier, TemplateTierDef> = {
  standard: { tier: 'standard', label: 'Standard', feature: null },
  premium: { tier: 'premium', label: 'Premium', feature: 'document-templates-premium' },
  custom: { tier: 'custom', label: 'Enterprise custom', feature: 'document-templates-custom' },
};

/** Lifecycle of a template in Humo's catalogue. Only preview and active can be used. */
export type TemplateStatus = 'planned' | 'preview' | 'active' | 'deprecated';

export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  planned: 'Planned',
  preview: 'Preview',
  active: 'Active',
  deprecated: 'Deprecated',
};

/** Which status moves Humo allows for a platform template. */
export const TEMPLATE_STATUS_MOVES: Record<TemplateStatus, TemplateStatus[]> = {
  planned: ['preview'],
  preview: ['active', 'planned'],
  active: ['deprecated'],
  deprecated: ['active'],
};

// ---------------------------------------------------------------- Design (the safe, structured part of a template)

/** Humo's own layouts. A template version picks one; nothing else renders. */
export type TemplateLayout =
  | 'levy-statement/classic'
  | 'levy-statement/branded'
  | 'meeting-notice/classic'
  | 'meeting-notice/branded'
  | 'meeting-minutes/classic'
  | 'meeting-minutes/branded';

/** Branded layouts draw the brand bar, wordmark and branded headings; classic ones keep Humo's plain letterhead. */
export function isBrandedLayout(layout: TemplateLayout): boolean {
  return layout.endsWith('/branded');
}

/** Whose look a template uses: Humo's neutral one, the agency's branding, or the template's own. */
export type BrandingMode = 'humo' | 'agency' | 'template';

/** Fonts a document may use: installed in the app and (later) on the PDF renderer. */
export type DocumentFont = 'dm-sans' | 'outfit' | 'serif';

export const DOCUMENT_FONTS: Record<DocumentFont, { label: string; stack: string }> = {
  'dm-sans': { label: 'DM Sans (Humo default)', stack: "'DM Sans', system-ui, sans-serif" },
  outfit: { label: 'Outfit', stack: "'Outfit', 'DM Sans', system-ui, sans-serif" },
  serif: { label: 'Serif (Georgia)', stack: "Georgia, 'Times New Roman', serif" },
};

/** Sections a levy statement layout knows how to draw, in order. A design may hide some; it can't invent new ones. (Meeting documents have fixed sections.) */
export type StatementSection = 'summary' | 'transactions' | 'payment' | 'queries';

export const STATEMENT_SECTIONS: Record<StatementSection, string> = {
  summary: 'Summary boxes',
  transactions: 'Transactions',
  payment: 'How to pay',
  queries: 'Queries and footer text',
};

export interface TemplatePalette {
  /** Headings, rules and the amount-due box. #rrggbb. */
  primary: string;
  /** Small highlights. #rrggbb. */
  accent: string;
}

/**
 * Everything a template version may change, as data the API validates:
 * colours are #rrggbb, fonts and sections come from fixed lists, text is plain
 * text (escaped when rendered), lengths are capped. This is the whole surface
 * an Enterprise custom template has.
 */
export interface TemplateDesign {
  layout: TemplateLayout;
  brandingMode: BrandingMode;
  /** Only for brandingMode 'template'. */
  palette?: TemplatePalette;
  font?: DocumentFont;
  /** Shown, in this order. Missing sections are hidden. */
  sections: StatementSection[];
  /** The document's own title, e.g. "Statement of account" (organisation terminology). */
  title?: string;
  /** Replaces the default queries line in the footer. */
  footerText?: string;
  /** A legal notice or disclaimer under the footer. */
  legalText?: string;
  /** Document numbers: prefix + period + account, e.g. "ACA-2026-09-PG-001". */
  numberPrefix?: string;
}

export const MAX_TEMPLATE_TEXT = 400;

// ---------------------------------------------------------------- Templates & versions

export type TemplateVersionStatus = 'draft' | 'published' | 'retired';

/**
 * An immutable snapshot of a template's design. A generated document records
 * the version it used, so a statement sent in September still renders with
 * September's version after the template changes.
 */
export interface TemplateVersion {
  version: number;
  status: TemplateVersionStatus;
  design: TemplateDesign;
  notes: string;
  publishedAt?: string;
  publishedBy?: string;
}

export interface DocumentTemplate {
  /** e.g. "levy-statement.standard", or "acacia.levy-statement" for a custom one. */
  id: string;
  documentType: DocumentType;
  name: string;
  description: string;
  /** Why this template exists — every template needs one. */
  purpose: string;
  tier: TemplateTier;
  status: TemplateStatus;
  /** Humo's default for its document type (one per type). */
  isDefault: boolean;
  /** Custom templates belong to one organisation; platform templates have none. */
  organisationId?: string;
  /** The version new documents use. */
  currentVersion: number;
  versions: TemplateVersion[];
  /** Concurrency token for changes to this template. */
  version: number;
}

/** What a generated document remembers about how it was laid out. */
export interface DocumentTemplateRef {
  templateId: string;
  version: number;
}

export function templateVersion(t: DocumentTemplate, version = t.currentVersion): TemplateVersion | undefined {
  return t.versions.find((v) => v.version === version);
}

// ---------------------------------------------------------------- Availability (the entitlement filter)

export type TemplateAvailabilityState = 'available' | 'locked' | 'planned' | 'deprecated';

export interface TemplateAvailability {
  template: DocumentTemplate;
  state: TemplateAvailabilityState;
  /** For locked templates: the entitlement that would unlock it. */
  unlock?: Feature;
}

/**
 * The registry's one rule: which templates of a type this organisation may use.
 * Driven only by the template's status and its tier's entitlement — never by
 * package names. (The API applies the same rule when a document is generated.)
 */
export function templateAvailability(t: DocumentTemplate, entitlements: EntitlementSet | null): TemplateAvailability {
  if (t.status === 'planned') return { template: t, state: 'planned' };
  if (t.status === 'deprecated') return { template: t, state: 'deprecated' };
  const feature = TEMPLATE_TIERS[t.tier].feature;
  if (feature && !(entitlements?.has(feature) ?? false)) return { template: t, state: 'locked', unlock: feature };
  return { template: t, state: 'available' };
}

export function templatesFor(type: DocumentType, all: DocumentTemplate[], entitlements: EntitlementSet | null): TemplateAvailability[] {
  const order: Record<TemplateTier, number> = { standard: 0, premium: 1, custom: 2 };
  return all
    .filter((t) => t.documentType === type)
    .sort((a, b) => order[a.tier] - order[b.tier] || Number(b.isDefault) - Number(a.isDefault))
    .map((t) => templateAvailability(t, entitlements));
}

// ---------------------------------------------------------------- Branding

/** In the simulation a logo is a wordmark; image logos arrive with file uploads. */
export interface DocumentLogo {
  kind: 'wordmark';
  text: string;
}

/** The organisation's own look, used by templates in 'agency' branding mode. Needs the document-branding entitlement. */
export interface AgencyBranding {
  logo?: DocumentLogo;
  palette: TemplatePalette;
  font: DocumentFont;
}

/** How people reach the agency about a document. Every customer has this; it's data, not a premium feature. */
export interface DocumentContact {
  email: string;
  phone: string;
}

/** An organisation's document settings. */
export interface OrganisationDocumentSettings {
  organisationId: string;
  /** Concurrency token. */
  version: number;
  /** Default template per document type. Missing types use Humo's default. */
  defaults: Partial<Record<DocumentType, string>>;
  contact: DocumentContact;
  /** Optional line in every document's footer, e.g. the agency's registration details. */
  footerText?: string;
  branding?: AgencyBranding;
}

/** The look a document is finally drawn with, after the hierarchy below. */
export interface ResolvedBranding {
  palette: TemplatePalette;
  font: DocumentFont;
  logo?: DocumentLogo;
  /** Where it came from, for "Using your agency branding" notes. */
  source: BrandingMode;
}

/** Humo's neutral look: the Standard levy statement as designed. */
export const HUMO_BRANDING: ResolvedBranding = {
  palette: { primary: '#041b40', accent: '#1d7a52' },
  font: 'dm-sans',
  source: 'humo',
};

/**
 * The branding hierarchy, in one place:
 *   Humo defaults → agency branding (if the template uses it and the agency is entitled)
 *   → the template's own design (Enterprise custom templates).
 * Documents themselves can't override branding: that keeps every document an
 * agency sends recognisably theirs and manageable.
 */
export function resolveBranding(design: TemplateDesign, settings: OrganisationDocumentSettings | undefined, entitlements: EntitlementSet | null): ResolvedBranding {
  if (design.brandingMode === 'template' && design.palette) {
    return { palette: design.palette, font: design.font ?? HUMO_BRANDING.font, logo: settings?.branding?.logo, source: 'template' };
  }
  const agency = settings?.branding;
  if (design.brandingMode === 'agency' && agency && (entitlements?.has('document-branding') ?? false)) {
    return { palette: agency.palette, font: design.font ?? agency.font, logo: agency.logo, source: 'agency' };
  }
  return HUMO_BRANDING;
}

/** A document number from the template's prefix, e.g. "ACA-2026-09-PG-001". */
export function documentNumber(design: TemplateDesign, period: string, reference: string): string | undefined {
  return design.numberPrefix ? `${design.numberPrefix}-${period}-${reference}` : undefined;
}

// ---------------------------------------------------------------- Validation shared with the API

const HEX = /^#[0-9a-f]{6}$/i;

/** The rules the API applies to a custom template design. Returns field → message. */
export function validateDesign(d: TemplateDesign): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.palette && !HEX.test(d.palette.primary)) e['primary'] = 'Use a colour like #0a3d62.';
  if (d.palette && !HEX.test(d.palette.accent)) e['accent'] = 'Use a colour like #1d7a52.';
  if (d.font && !(d.font in DOCUMENT_FONTS)) e['font'] = 'Choose one of the listed fonts.';
  if (d.layout.startsWith('levy-statement/') && !d.sections.includes('transactions')) e['transactions'] = 'A statement always shows its transactions.';
  for (const k of ['title', 'footerText', 'legalText'] as const) {
    if ((d[k]?.length ?? 0) > MAX_TEMPLATE_TEXT) e[k] = `Keep this under ${MAX_TEMPLATE_TEXT} characters.`;
  }
  if (d.title !== undefined && d.title.trim().length > 60) e['title'] = 'Keep the title under 60 characters.';
  if (d.numberPrefix && !/^[A-Z0-9]{2,8}$/.test(d.numberPrefix)) e['numberPrefix'] = '2–8 capital letters or digits.';
  return e;
}

export function isHexColour(v: string): boolean {
  return HEX.test(v);
}
