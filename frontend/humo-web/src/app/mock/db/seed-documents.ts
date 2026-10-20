import { ALL_SECTIONS, BRANDED_STATEMENT, PLATFORM_PUBLISHED_AT, DocumentTemplate, OrganisationDocumentSettings, PLATFORM_TEMPLATES } from '../../domain';
import { seeded } from './random';
import { CustomerSeed } from './seed-platform';
import { PERSONAS } from '../fixtures/personas';

export function seedTemplates(): DocumentTemplate[] {
  return [
    ...PLATFORM_TEMPLATES,
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
      organisationId: 'marula',
      version: 1,
      defaults: { 'levy-statement': 'levy-statement.professional' },
      contact: { email: 'levies@marula-pm.example', phone: '012 430 7710' },
      branding: { logo: { kind: 'wordmark', text: 'Marula Property' }, palette: { primary: '#5b1a32', accent: '#c2410c' }, font: 'dm-sans' },
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
        versions: [{ version: 1, status: 'published', notes: 'Set up with Humo onboarding.', publishedAt: PLATFORM_PUBLISHED_AT, publishedBy: PERSONAS.find((p) => p.id === c.accountManagerId)?.name ?? 'Humo onboarding', design: { ...BRANDED_STATEMENT, brandingMode: 'template', palette, font: 'dm-sans' } }],
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
