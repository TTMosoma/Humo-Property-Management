import { DocumentTemplate, DocumentType, OrganisationDocumentSettings, StatementSection, TemplateDesign, TemplateTier } from '../../domain';
import { seeded } from './random';
import { CustomerSeed } from './seed-platform';

const ALL_SECTIONS: StatementSection[] = ['summary', 'transactions', 'payment', 'queries'];
const PUBLISHED = '2026-06-01T09:00:00+02:00';

const CLASSIC: TemplateDesign = { layout: 'levy-statement/classic', brandingMode: 'humo', sections: ALL_SECTIONS };
const BRANDED: TemplateDesign = { layout: 'levy-statement/branded', brandingMode: 'agency', sections: ALL_SECTIONS };
const NOTICE: TemplateDesign = { layout: 'meeting-notice/classic', brandingMode: 'humo', sections: [] };
const NOTICE_BRANDED: TemplateDesign = { layout: 'meeting-notice/branded', brandingMode: 'agency', sections: [] };
const MINUTES: TemplateDesign = { layout: 'meeting-minutes/classic', brandingMode: 'humo', sections: [] };
const MINUTES_BRANDED: TemplateDesign = { layout: 'meeting-minutes/branded', brandingMode: 'agency', sections: [] };

function platform(
  id: string,
  documentType: DocumentType,
  tier: TemplateTier,
  name: string,
  description: string,
  purpose: string,
  design?: TemplateDesign,
  isDefault = false,
): DocumentTemplate {
  return {
    id,
    documentType,
    name,
    description,
    purpose,
    tier,
    // Templates without a design are catalogue entries for layouts Humo hasn't built yet.
    status: design ? 'active' : 'planned',
    isDefault,
    currentVersion: design ? 1 : 0,
    versions: design ? [{ version: 1, status: 'published', design, notes: 'First release.', publishedAt: PUBLISHED, publishedBy: 'Humo' }] : [],
    version: 1,
  };
}

/** Humo's catalogue. The levy statement is the first document type with real layouts; the rest are planned. */
export function seedTemplates(): DocumentTemplate[] {
  return [
    platform('levy-statement.standard', 'levy-statement', 'standard', 'Standard',
      'Clean Humo layout: summary, transactions and how to pay on one A4 page.',
      'Every customer gets a clear, correct statement without setting anything up.', CLASSIC, true),
    platform('levy-statement.professional', 'levy-statement', 'premium', 'Professional',
      'The same statement in your agency’s colours, font and logo.',
      'Agencies want owners to recognise their statements as theirs, not Humo’s.', BRANDED),
    platform('levy-statement.executive', 'levy-statement', 'premium', 'Executive',
      'Adds an account-at-a-glance panel: 12-month balance trend and arrears ageing.',
      'Larger schemes and trustees ask for the trend, not just this month’s lines.'),
    platform('invoice.standard', 'invoice', 'standard', 'Standard', 'Clean Humo invoice.', 'Ad-hoc charges need a proper tax-compliant document.', undefined, true),
    platform('invoice.professional', 'invoice', 'premium', 'Professional', 'Invoice in your agency’s branding.', 'Matches branded statements.'),
    platform('receipt.standard', 'receipt', 'standard', 'Standard', 'Payment receipt with allocation.', 'Owners ask for proof of payment.', undefined, true),
    platform('receipt.professional', 'receipt', 'premium', 'Professional', 'Receipt in your agency’s branding.', 'Matches branded statements.'),
    platform('work-order.standard', 'work-order', 'standard', 'Standard', 'Scope, site access and approval for a supplier.', 'Suppliers need one clear instruction to work to.', undefined, true),
    platform('work-order.professional', 'work-order', 'premium', 'Professional', 'Work order in your agency’s branding, with terms.', 'Agencies attach their own conditions of appointment.'),
    platform('meeting-notice.standard', 'meeting-notice', 'standard', 'Standard',
      'Date, venue, notice period and the numbered agenda on one A4 page.',
      'Trustees and owners must receive written notice; this is a correct one with no setting up.', NOTICE, true),
    platform('meeting-notice.professional', 'meeting-notice', 'premium', 'Professional',
      'The notice in your agency’s colours, font and wordmark.',
      'Matches branded statements, so owners recognise post from their agent.', NOTICE_BRANDED),
    platform('meeting-minutes.standard', 'meeting-minutes', 'standard', 'Standard',
      'Attendance, quorum, the minute of each agenda item, resolutions with votes, and actions.',
      'The scheme’s formal record of decisions; every customer needs a correct one.', MINUTES, true),
    platform('meeting-minutes.professional', 'meeting-minutes', 'premium', 'Professional',
      'The minutes in your agency’s branding.',
      'Matches the agency’s other documents.', MINUTES_BRANDED),
    // An Enterprise custom template: Acacia's own statement, on its second version.
    {
      id: 'acacia.levy-statement',
      documentType: 'levy-statement',
      name: 'Acacia statement of account',
      description: 'Acacia’s own levy statement: their colours and wording, numbered statements and legal notice.',
      purpose: 'Acacia’s board asked for statements that match their letterheads and carry their legal notice.',
      tier: 'custom',
      status: 'active',
      isDefault: false,
      organisationId: 'acacia',
      currentVersion: 2,
      version: 2,
      versions: [
        {
          version: 1,
          status: 'retired',
          notes: 'Set up with Humo onboarding.',
          publishedAt: '2026-07-14T10:00:00+02:00',
          publishedBy: 'Dumisani Ngcobo (Humo)',
          design: { layout: 'levy-statement/branded', brandingMode: 'template', palette: { primary: '#14532d', accent: '#b45309' }, font: 'outfit', sections: ALL_SECTIONS, title: 'Statement of account' },
        },
        {
          version: 2,
          status: 'published',
          notes: 'Deeper green, numbered statements and the legal notice the board approved.',
          publishedAt: '2026-08-20T15:30:00+02:00',
          publishedBy: 'Thandeka Mokoena',
          design: {
            layout: 'levy-statement/branded',
            brandingMode: 'template',
            palette: { primary: '#0b3d2e', accent: '#b45309' },
            font: 'outfit',
            sections: ALL_SECTIONS,
            title: 'Statement of account',
            numberPrefix: 'ACA',
            footerText: 'Questions about this statement? Email accounts@acacia-ma.example or call 011 555 0142, weekdays 08:00–16:30.',
            legalText: 'Acacia Managing Agents (Pty) Ltd acts as managing agent for the body corporate. Levies are payable in terms of the Sectional Titles Schemes Management Act 8 of 2011 and the scheme’s rules.',
          },
        },
      ],
    },
  ];
}

/** Every organisation's document settings. Named customers have real ones; the rest get Humo defaults. */
export function seedDocumentSettings(): OrganisationDocumentSettings[] {
  return [
    {
      organisationId: 'acacia',
      version: 1,
      defaults: { 'levy-statement': 'levy-statement.standard' },
      contact: { email: 'accounts@acacia-ma.example', phone: '011 555 0142' },
      branding: { logo: { kind: 'wordmark', text: 'Acacia' }, palette: { primary: '#0b3d2e', accent: '#b45309' }, font: 'outfit' },
    },
    {
      organisationId: 'tshikrand',
      version: 1,
      defaults: { 'levy-statement': 'levy-statement.professional' },
      contact: { email: 'levies@tshikrand.example', phone: '012 430 7710' },
      branding: { logo: { kind: 'wordmark', text: 'Tshikrand' }, palette: { primary: '#5b1a32', accent: '#c2410c' }, font: 'dm-sans' },
    },
  ];
}

/** Settings for an organisation that hasn't set anything up: Humo's defaults and contact details from its name. */
export function defaultDocumentSettings(organisationId: string, phone = '010 500 0000'): OrganisationDocumentSettings {
  return { organisationId, version: 1, defaults: {}, contact: { email: `accounts@${organisationId}.example`, phone } };
}

const PALETTES = [
  { primary: '#1e3a5f', accent: '#d97706' },
  { primary: '#3f1d38', accent: '#0f766e' },
  { primary: '#14532d', accent: '#a16207' },
  { primary: '#7c2d12', accent: '#1d4ed8' },
];

/**
 * The rest of Humo's customers, so adoption reads like a real business: some
 * Professional and Enterprise customers brand their statements, and some
 * Enterprise customers have their own template.
 */
export function seedCustomerDocuments(customers: CustomerSeed[], named: string[]): { settings: OrganisationDocumentSettings[]; templates: DocumentTemplate[] } {
  const settings: OrganisationDocumentSettings[] = [];
  const templates: DocumentTemplate[] = [];
  for (const c of customers.filter((x) => !named.includes(x.organisationId))) {
    const r = seeded(`docs-${c.organisationId}`);
    const pkg = c.subscription.packageId;
    const palette = PALETTES[Math.floor(r() * PALETTES.length)];
    const word = c.name.split(' ')[0];
    const custom = pkg === 'enterprise' && r() < 0.3;
    const branded = pkg !== 'essentials' && r() < 0.35;
    if (custom) {
      const id = `${c.organisationId}.levy-statement`;
      templates.push({
        id,
        documentType: 'levy-statement',
        name: `${word} levy statement`,
        description: `${c.name}’s own levy statement.`,
        purpose: 'Enterprise custom template.',
        tier: 'custom',
        status: 'active',
        isDefault: false,
        organisationId: c.organisationId,
        currentVersion: 1,
        version: 1,
        versions: [{ version: 1, status: 'published', notes: 'Set up with Humo onboarding.', publishedAt: PUBLISHED, publishedBy: c.accountManager, design: { ...BRANDED, brandingMode: 'template', palette, font: 'dm-sans' } }],
      });
    }
    if (custom || branded) {
      settings.push({
        organisationId: c.organisationId,
        version: 1,
        defaults: { 'levy-statement': custom ? `${c.organisationId}.levy-statement` : 'levy-statement.professional' },
        contact: { email: `accounts@${c.organisationId}.example`, phone: `0${10 + Math.floor(r() * 80)} ${100 + Math.floor(r() * 899)} ${1000 + Math.floor(r() * 8999)}` },
        branding: { logo: { kind: 'wordmark', text: word }, palette, font: 'dm-sans' },
      });
    }
  }
  return { settings, templates };
}
