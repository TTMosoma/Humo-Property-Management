import { DocumentTemplate, DocumentType, StatementSection, TemplateDesign, TemplateTier } from './document';

/**
 * Humo's built-in document templates: the same catalogue in the app and on the API
 * (contracts/document-templates.json; the contract test fails if they drift). Agencies choose
 * among these per document type; Enterprise custom templates (D12) are added per organisation.
 */
export const ALL_SECTIONS: StatementSection[] = ['summary', 'transactions', 'payment', 'queries'];
export const PLATFORM_PUBLISHED_AT = '2026-06-01T09:00:00+02:00';

const CLASSIC: TemplateDesign = { layout: 'levy-statement/classic', brandingMode: 'humo', sections: ALL_SECTIONS };
export const BRANDED_STATEMENT: TemplateDesign = { layout: 'levy-statement/branded', brandingMode: 'agency', sections: ALL_SECTIONS };
const NOTICE: TemplateDesign = { layout: 'meeting-notice/classic', brandingMode: 'humo', sections: [] };
const NOTICE_BRANDED: TemplateDesign = { layout: 'meeting-notice/branded', brandingMode: 'agency', sections: [] };
const MINUTES: TemplateDesign = { layout: 'meeting-minutes/classic', brandingMode: 'humo', sections: [] };
const NOTICE_PAY: TemplateDesign = { layout: 'payment-notice/classic', brandingMode: 'humo', sections: [] };
const NOTICE_PAY_BRANDED: TemplateDesign = { layout: 'payment-notice/branded', brandingMode: 'agency', sections: [] };
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
    versions: design ? [{ version: 1, status: 'published', design, notes: 'First release.', publishedAt: PLATFORM_PUBLISHED_AT, publishedBy: 'Humo' }] : [],
    version: 1,
  };
}

/** Humo's catalogue. The levy statement is the first document type with real layouts; the rest are planned. */
export const PLATFORM_TEMPLATES: DocumentTemplate[] = [
    platform('levy-statement.standard', 'levy-statement', 'standard', 'Standard',
      'Clean Humo layout: summary, transactions and how to pay on one A4 page.',
      'Every customer gets a clear, correct statement without setting anything up.', CLASSIC, true),
    platform('levy-statement.professional', 'levy-statement', 'premium', 'Professional',
      'The same statement in your agency’s colours, font and logo.',
      'Agencies want owners to recognise their statements as theirs, not Humo’s.', BRANDED_STATEMENT),
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
    platform('payment-notice.standard', 'payment-notice', 'standard', 'Standard',
      'Reminder, final demand and letter of demand: the amount overdue, its ageing, how to pay and what happens next.',
      'Owners must be told clearly and fairly before collection escalates; every customer needs that.', NOTICE_PAY, true),
    platform('payment-notice.professional', 'payment-notice', 'premium', 'Professional',
      'Collection letters in your agency’s colours, font and wordmark.',
      'Matches the agency’s statements, so the letter is recognisably from them.', NOTICE_PAY_BRANDED),
    platform('meeting-minutes.standard', 'meeting-minutes', 'standard', 'Standard',
      'Attendance, quorum, the minute of each agenda item, resolutions with votes, and actions.',
      'The scheme’s formal record of decisions; every customer needs a correct one.', MINUTES, true),
    platform('meeting-minutes.professional', 'meeting-minutes', 'premium', 'Professional',
      'The minutes in your agency’s branding.',
      'Matches the agency’s other documents.', MINUTES_BRANDED),
];
