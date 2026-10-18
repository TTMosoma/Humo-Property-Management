import { DOCUMENT_FONTS, DOCUMENT_TYPE_META, DocumentFont, DocumentTemplate, DocumentTemplateDataSource, DocumentType, MAX_TEMPLATE_TEXT, OrganisationDocumentSettings, PlatformTemplateDataSource, STATEMENT_SECTIONS, StatementSection, TEMPLATE_STATUS_LABELS, TEMPLATE_STATUS_MOVES, TEMPLATE_TIERS, TemplateAvailability, TemplateDesign, TemplateStatus, templateVersion, todaySA } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FormField, FormValues, REASON_FIELD, openForm } from '../shared/form-drawer';

const FONT_OPTIONS = Object.entries(DOCUMENT_FONTS).map(([value, f]) => ({ value, label: f.label }));
const SHOW_HIDE = [
  { value: 'show', label: 'Show' },
  { value: 'hide', label: 'Hide' },
];

export function defaultTemplateForm(drawer: DrawerService, data: DocumentTemplateDataSource, type: DocumentType, options: TemplateAvailability[], settings: OrganisationDocumentSettings, current?: string): void {
  const label = DOCUMENT_TYPE_META[type].label;
  openForm(drawer, {
    eyebrow: 'Documents & templates',
    title: `Default ${label.toLowerCase()} template`,
    intro: `New ${label.toLowerCase()}s use this template. Documents already issued keep the template and version they were issued with.`,
    fields: [
      {
        key: 'templateId',
        label: 'Template',
        type: 'select',
        required: true,
        options: options.filter((o) => o.state === 'available').map((o) => ({ value: o.template.id, label: `${o.template.name} (${TEMPLATE_TIERS[o.template.tier].label})` })),
      },
    ],
    initial: { templateId: current ?? '' },
    submitLabel: 'Save default',
    submit: (v) => data.setDefault(type, v['templateId'], settings.version),
    success: () => `New ${label.toLowerCase()}s will use this template.`,
    failure: 'The default wasn’t changed',
  });
}

/** Contact details for every customer; logo, colours and font only with the branding entitlement. */
export function brandingForm(drawer: DrawerService, data: DocumentTemplateDataSource, settings: OrganisationDocumentSettings, branded: boolean): void {
  const b = settings.branding;
  const fields: FormField[] = [
    { key: 'email', label: 'Email on documents', type: 'email', required: true, half: true },
    { key: 'phone', label: 'Phone on documents', type: 'tel', required: true, half: true },
    { key: 'footerText', label: 'Footer line', type: 'text', help: 'Optional, e.g. your registration number. Printed under every document’s footer.' },
  ];
  if (branded) {
    fields.push(
      { key: 'logo', label: 'Wordmark', type: 'text', help: 'Shown as your logo on branded templates. Image logos come with file uploads.' },
      { key: 'primary', label: 'Main colour', type: 'color', required: true, half: true },
      { key: 'accent', label: 'Accent colour', type: 'color', required: true, half: true },
      { key: 'font', label: 'Font', type: 'select', required: true, options: FONT_OPTIONS },
    );
  }
  openForm(drawer, {
    eyebrow: 'Documents & templates',
    title: branded ? 'Contact details & branding' : 'Contact details',
    intro: branded
      ? 'Used by templates that carry your branding (Professional). Humo’s Standard template keeps its own look.'
      : 'Printed on every document you send. Your own logo and colours come with the Document & Branding Pack or Humo Professional.',
    fields,
    initial: {
      email: settings.contact.email,
      phone: settings.contact.phone,
      footerText: settings.footerText ?? '',
      logo: b?.logo?.text ?? '',
      primary: b?.palette.primary ?? '#041b40',
      accent: b?.palette.accent ?? '#1d7a52',
      font: b?.font ?? 'dm-sans',
    },
    submitLabel: 'Save',
    submit: (v) =>
      data.updateBranding(
        {
          contact: { email: v['email'], phone: v['phone'] },
          footerText: v['footerText'],
          branding: branded
            ? { logo: v['logo'].trim() ? { kind: 'wordmark', text: v['logo'].trim() } : undefined, palette: { primary: v['primary'], accent: v['accent'] }, font: v['font'] as DocumentFont }
            : undefined,
        },
        settings.version,
      ),
    success: () => 'Saved. Documents you generate from now on use these details.',
    failure: 'The details weren’t saved',
  });
}

/**
 * An Enterprise custom template's next version (D12: Humo-owned, published by Humo after
 * the client approves a proof). Structured fields only: the API validates every value.
 */
export function customTemplateForm(drawer: DrawerService, data: PlatformTemplateDataSource, t: DocumentTemplate, customer: string): void {
  const d = templateVersion(t)?.design;
  const sections = Object.keys(STATEMENT_SECTIONS) as StatementSection[];
  const toggles: FormField[] = sections
    .filter((s) => s !== 'transactions')
    .map((s) => ({ key: `s-${s}`, label: STATEMENT_SECTIONS[s], type: 'select', required: true, half: true, options: SHOW_HIDE }));
  openForm(drawer, {
    eyebrow: `${customer} · ${t.name}`,
    title: `Publish version ${t.currentVersion + 1}`,
    intro: `Publish only what ${customer} approved as a proof. Version ${t.currentVersion} stays on record: documents already issued with it keep rendering exactly as they were sent.`,
    fields: [
      { key: 'title', label: 'Document title', type: 'text', placeholder: 'Levy statement', help: 'Your organisation’s word for it, e.g. “Statement of account”.' },
      { key: 'primary', label: 'Main colour', type: 'color', required: true, half: true },
      { key: 'accent', label: 'Accent colour', type: 'color', required: true, half: true },
      { key: 'font', label: 'Font', type: 'select', required: true, options: FONT_OPTIONS },
      ...toggles,
      { key: 'numberPrefix', label: 'Document number prefix', type: 'text', half: true, placeholder: 'ACA', help: 'Numbers read PREFIX-period-account.' },
      { key: 'footerText', label: 'Footer text', type: 'textarea', help: `Replaces the standard queries line. Plain text, up to ${MAX_TEMPLATE_TEXT} characters.` },
      { key: 'legalText', label: 'Legal notice', type: 'textarea', help: 'Printed in small type at the end of the document.' },
      { key: 'notes', label: 'What changed', type: 'text', required: true, help: 'Shown in the version history.' },
      { key: 'approvedBy', label: 'Proof approved by', type: 'text', required: true, half: true, placeholder: 'Name and role at the client' },
      { key: 'approvedOn', label: 'Approved on', type: 'date', required: true, half: true },
    ],
    initial: {
      title: d?.title ?? '',
      primary: d?.palette?.primary ?? '#041b40',
      accent: d?.palette?.accent ?? '#1d7a52',
      font: d?.font ?? 'dm-sans',
      numberPrefix: d?.numberPrefix ?? '',
      footerText: d?.footerText ?? '',
      legalText: d?.legalText ?? '',
      ...Object.fromEntries(sections.map((s) => [`s-${s}`, !d || d.sections.includes(s) ? 'show' : 'hide'])),
      approvedOn: todaySA(),
    },
    submitLabel: `Publish version ${t.currentVersion + 1}`,
    submit: (v) => data.publishCustomVersion(t.id, designFrom(v, sections), v['notes'], { approvedBy: v['approvedBy'], approvedOn: v['approvedOn'] }, t.version),
    success: (n) => `Version ${n} is live. New documents use it; earlier ones keep their version.`,
    failure: 'The new version wasn’t published',
  });
}

function designFrom(v: FormValues, sections: StatementSection[]): TemplateDesign {
  const text = (k: string) => v[k]?.trim() || undefined;
  return {
    layout: 'levy-statement/branded',
    brandingMode: 'template',
    palette: { primary: v['primary'], accent: v['accent'] },
    font: v['font'] as DocumentFont,
    sections: sections.filter((s) => s === 'transactions' || v[`s-${s}`] !== 'hide'),
    title: text('title'),
    numberPrefix: text('numberPrefix')?.toUpperCase(),
    footerText: text('footerText'),
    legalText: text('legalText'),
  };
}

// ---- Humo platform

export function templateStatusForm(drawer: DrawerService, data: PlatformTemplateDataSource, t: DocumentTemplate): void {
  openForm(drawer, {
    eyebrow: `${DOCUMENT_TYPE_META[t.documentType].label} · ${t.name}`,
    title: 'Change template status',
    intro: 'Planned templates are hidden from customers; preview and active ones can be used by customers whose plan includes their tier; deprecated ones stay for documents already issued.',
    fields: [
      { key: 'status', label: 'New status', type: 'select', required: true, options: TEMPLATE_STATUS_MOVES[t.status].map((s) => ({ value: s, label: TEMPLATE_STATUS_LABELS[s] })) },
      REASON_FIELD,
    ],
    initial: { status: TEMPLATE_STATUS_MOVES[t.status][0] },
    submitLabel: 'Change status',
    submit: (v) => data.setStatus(t.id, v['status'] as TemplateStatus, v['reason'], t.version),
    success: (_r, v) => `${t.name} is now ${TEMPLATE_STATUS_LABELS[v['status'] as TemplateStatus].toLowerCase()}.`,
    failure: 'The status wasn’t changed',
  });
}

export function setUpCustomTemplateForm(drawer: DrawerService, data: PlatformTemplateDataSource, customers: { id: string; name: string }[]): void {
  openForm(drawer, {
    eyebrow: 'Document templates',
    title: 'Set up a custom template',
    intro: 'A paid Enterprise service (D12): Humo designs the template from the customer’s brief, and publishes each version once they approve a proof. It starts from Humo’s Standard design. The customer must be entitled to custom templates.',
    fields: [
      { key: 'organisationId', label: 'Customer', type: 'select', required: true, options: customers.map((c) => ({ value: c.id, label: c.name })) },
      { key: 'documentType', label: 'Document', type: 'select', required: true, options: [{ value: 'levy-statement', label: DOCUMENT_TYPE_META['levy-statement'].label }] },
    ],
    initial: { documentType: 'levy-statement' },
    submitLabel: 'Set up template',
    submit: (v) => data.createCustomTemplate(v['organisationId'], v['documentType'] as DocumentType),
    success: () => 'Custom template set up. Publish its first design from this page once the customer approves a proof.',
    failure: 'The template wasn’t set up',
  });
}
