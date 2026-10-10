import { AuditEvent, AuditParty } from '../../domain';

const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const D = 24;

const terry: AuditParty = { identityId: 'p-terry', name: 'Terry Mosoma' };
const sarah: AuditParty = { identityId: 'p-sarah', name: 'Sarah Jacobs' };
const thandeka: AuditParty = { identityId: 'p-thandeka', name: 'Thandeka Mokoena' };
const johan: AuditParty = { identityId: 'p-johan', name: 'Johan van der Merwe' };
const priya: AuditParty = { identityId: 'p-priya', name: 'Priya Naidoo' };
const sipho: AuditParty = { identityId: 'p-sipho', name: 'Sipho Khumalo' };
const annette: AuditParty = { identityId: 'p-annette', name: 'Annette Visser' };
const lerato: AuditParty = { identityId: 'p-lerato', name: 'Lerato Dube' };

const OFFICE = { ip: '196.21.45.10', device: 'Chrome on Windows 11' };
const HUMO = { ip: '102.65.12.4', device: 'Edge on Windows 11' };

let n = 0;
function ev(hoursAgo: number, e: Omit<AuditEvent, 'id' | 'at' | 'session'> & { session?: Partial<AuditEvent['session']> }): AuditEvent {
  n++;
  const base = e.actor.identityId === 'p-terry' || e.actor.identityId === 'p-lerato' ? HUMO : OFFICE;
  return { ...e, id: `ae-${String(n).padStart(3, '0')}`, at: at(hoursAgo), session: { ...base, sessionId: `s-${1000 + n}`, ...e.session } };
}

/** About two weeks of history, including the two impersonation sessions the brief describes. */
export function seedAudit(): AuditEvent[] {
  n = 0;
  return [
    // ---- Today ----
    ev(0.6, { category: 'security', actor: sarah, role: 'portfolio-manager', organisationId: 'acacia', action: 'Signed in', result: 'success', stepUp: { method: 'passkey', device: 'Windows Hello · Work laptop' } }),
    ev(2.2, { category: 'security', actor: sarah, role: 'finance', organisationId: 'acacia', action: 'Switched role to Finance User', resource: 'Role assignment', resourceId: 'm-sarah-finance', result: 'success' }),
    ev(2.6, { category: 'activity', actor: priya, role: 'finance', organisationId: 'acacia', schemeId: 'kingfisher-court', action: 'Allocated receipt to KC 42', resource: 'Receipt', resourceId: 'RC-88412', amount: 3480, result: 'success' }),
    ev(5.5, { category: 'security', actor: priya, role: 'finance', organisationId: 'acacia', action: 'Signed in', result: 'success', stepUp: { method: 'mobile', device: 'Humo Mobile · Priya’s Samsung Galaxy S24' } }),
    ev(7.1, { category: 'security', actor: johan, role: 'portfolio-manager', organisationId: 'acacia', action: 'Signed in', result: 'success', stepUp: { method: 'passkey', device: 'Google Password Manager · Johan’s phone' } }),

    // ---- Yesterday: Observe-mode impersonation of Sarah (support) ----
    ev(26, {
      category: 'impersonation', actor: terry, actingAs: sarah, role: 'portfolio-manager', organisationId: 'acacia',
      action: 'Started impersonation', resource: 'Identity', resourceId: 'p-sarah', result: 'success',
      impersonation: { mode: 'observe', reason: 'support', note: 'HUMO-2317 · “Scheduled” column on the Protea Gardens job board looks empty' },
    }),
    ev(25.7, {
      category: 'activity', actor: terry, actingAs: sarah, role: 'portfolio-manager', organisationId: 'acacia', schemeId: 'protea-gardens',
      action: 'Tried to close job', resource: 'Job', resourceId: 'MR-0978', result: 'denied', reason: 'Observe mode is read-only',
      impersonation: { mode: 'observe', reason: 'support' },
    }),
    ev(25.4, {
      category: 'impersonation', actor: terry, actingAs: sarah, role: 'portfolio-manager', organisationId: 'acacia',
      action: 'Ended impersonation (36 min)', resource: 'Identity', resourceId: 'p-sarah', result: 'success',
      impersonation: { mode: 'observe', reason: 'support' },
    }),
    ev(22, { category: 'security', actor: thandeka, role: 'agency-admin', organisationId: 'acacia', action: 'Signed in', result: 'success', stepUp: { method: 'passkey', device: 'Windows Hello · Work laptop' } }),
    ev(20, { category: 'activity', actor: johan, role: 'portfolio-manager', organisationId: 'acacia', schemeId: 'kingfisher-court', action: 'Logged a call on Unit 42', resource: 'Unit', resourceId: 'KC 42', result: 'success' }),

    // ---- This week ----
    ev(2 * D, { category: 'activity', actor: priya, role: 'finance', organisationId: 'acacia', schemeId: 'kingfisher-court', action: 'Created payment batch', resource: 'Payment batch', resourceId: 'PB-0412', amount: 58940.2, result: 'success' }),
    ev(2 * D + 3, {
      category: 'activity', actor: priya, role: 'finance', organisationId: 'acacia', schemeId: 'the-willows', action: 'Released payment batch', resource: 'Payment batch', resourceId: 'PB-0409', amount: 41200,
      result: 'success', stepUp: { method: 'mobile', device: 'Humo Mobile · Priya’s Samsung Galaxy S24' },
    }),
    ev(3 * D, { category: 'activity', actor: sipho, role: 'trustee', organisationId: 'acacia', schemeId: 'the-willows', action: 'Approved payment batch (second authoriser)', resource: 'Payment batch', resourceId: 'PB-0409', amount: 41200, result: 'success' }),
    ev(3 * D + 2, {
      category: 'security', actor: johan, role: 'portfolio-manager', organisationId: 'acacia', action: 'Sign-in failed — passkey not recognised', result: 'failed',
      reason: 'Unknown device', session: { ip: '105.224.3.18', device: 'Firefox on Windows 10' },
    }),
    ev(4 * D, {
      category: 'activity', actor: thandeka, role: 'agency-admin', organisationId: 'acacia', action: 'Exported debtors age analysis', resource: 'Export', resourceId: 'debtors-2026-09',
      result: 'success', stepUp: { method: 'passkey', device: 'Windows Hello · Work laptop' },
    }),

    // ---- Act-mode impersonation (data correction), with the action it performed ----
    ev(5 * D, {
      category: 'impersonation', actor: terry, actingAs: sarah, role: 'finance', organisationId: 'acacia',
      action: 'Started impersonation', resource: 'Identity', resourceId: 'p-sarah', result: 'success',
      stepUp: { method: 'passkey', device: 'Windows Hello · Studio laptop' },
      impersonation: { mode: 'act', reason: 'data-correction', note: 'HUMO-2291 · Invoice captured against the wrong scheme; customer asked Humo to correct and approve' },
    }),
    ev(5 * D - 0.3, {
      category: 'activity', actor: terry, actingAs: sarah, role: 'finance', organisationId: 'acacia', schemeId: 'kingfisher-court',
      action: 'Approved supplier invoice', resource: 'Invoice', resourceId: 'INV-20931', amount: 18450, result: 'success',
      stepUp: { method: 'passkey', device: 'Windows Hello · Studio laptop' },
      impersonation: { mode: 'act', reason: 'data-correction', note: 'HUMO-2291' },
    }),
    ev(5 * D - 0.5, {
      category: 'impersonation', actor: terry, actingAs: sarah, role: 'finance', organisationId: 'acacia',
      action: 'Ended impersonation (14 min)', resource: 'Identity', resourceId: 'p-sarah', result: 'success',
      impersonation: { mode: 'act', reason: 'data-correction' },
    }),

    // ---- Last week and earlier ----
    ev(8 * D, {
      category: 'security', actor: thandeka, role: 'agency-admin', organisationId: 'acacia', action: 'Removed role Portfolio Manager · Northcliff View from Kabelo Molefe',
      resource: 'Role assignment', resourceId: 'm-kabelo-nv', result: 'success', stepUp: { method: 'passkey', device: 'Windows Hello · Work laptop' },
    }),
    ev(9 * D, { category: 'security', actor: sarah, role: 'portfolio-manager', organisationId: 'acacia', action: 'Added a passkey (Google Password Manager)', resource: 'Passkey', result: 'success', stepUp: { method: 'passkey', device: 'Windows Hello · Work laptop' } }),
    ev(10 * D, { category: 'activity', actor: johan, role: 'portfolio-manager', organisationId: 'acacia', schemeId: 'kingfisher-court', action: 'Approved quote within delegated authority', resource: 'Job', resourceId: 'MR-1012', amount: 4650, result: 'success' }),
    ev(12 * D, {
      category: 'impersonation', actor: terry, actingAs: annette, role: 'agency-admin', organisationId: 'fynbos', action: 'Started impersonation', resource: 'Identity', resourceId: 'p-annette', result: 'success',
      impersonation: { mode: 'observe', reason: 'bug', note: 'HUMO-2240 · Statement PDF cuts off the banking details' },
    }),
    ev(12 * D - 0.4, {
      category: 'impersonation', actor: terry, actingAs: annette, role: 'agency-admin', organisationId: 'fynbos', action: 'Ended impersonation (22 min)', resource: 'Identity', resourceId: 'p-annette', result: 'success',
      impersonation: { mode: 'observe', reason: 'bug' },
    }),
    ev(13 * D, { category: 'security', actor: lerato, role: 'humo-support', organisationId: null, action: 'Signed in', result: 'success', stepUp: { method: 'mobile', device: 'Humo Mobile · Lerato’s iPhone' } }),
    ev(15 * D, { category: 'security', actor: thandeka, role: 'agency-admin', organisationId: 'acacia', action: 'Signed out all other sessions', resource: 'Session', result: 'success', stepUp: { method: 'passkey', device: 'Windows Hello · Work laptop' } }),
  ];
}
