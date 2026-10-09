import { ComplianceType, Job, LibraryCategory, LibraryDocument, RecordKind, RecordLink, Supplier, DocumentVisibility } from '../../domain';
import { MockDb } from './mock-db';
import { seeded } from './random';

type Resolver = (kind: RecordKind, id: string) => { link: RecordLink; schemeIds: string[] } | undefined;

/** Schemes with lifts: they need a current lift inspection certificate. */
export const LIFT_SCHEMES = ['kingfisher-court', 'rosebank-terraces', 'sea-point-atlantic', 'linden-court', 'umhlanga-ridge'];

/** Days from now at 23:59 (expiries) or 10:00 (uploads). */
const inDays = (n: number, hour = 23, minute = 59) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const UPLOADERS = ['Johan van der Merwe', 'Naledi Sithole', 'Thandeka Mokoena', 'Priya Naidoo'];

/** Expiry offsets (days) for the demo's story: everything else is current. */
const INSURANCE_EXPIRY: Record<string, number> = { 'jacaranda-heights': 5, 'midrand-crossing': 21 };
const FIRE_EXPIRY: Record<string, number> = { 'ballito-dunes': -12, 'greenstone-commons': 18 };
const LIFT_EXPIRY: Record<string, number> = { 'sea-point-atlantic': 12 };

/**
 * The library a mid-sized agency would have: per scheme, the insurance policy,
 * fire equipment certificate, lift certificate where there are lifts, and
 * conduct rules; every supplier's vetting documents on file; and a few
 * documents on units, people and jobs from the demo story.
 */
export function seedLibrary(db: MockDb, suppliers: Supplier[], jobs: Job[], resolve: Resolver): LibraryDocument[] {
  const docs: LibraryDocument[] = [];
  let n = 0;

  const add = (
    record: { kind: RecordKind; id: string },
    d: { title: string; fileName: string; category: LibraryCategory; visibility: DocumentVisibility; expiresAt?: string; compliance?: ComplianceType; notes?: string; uploadedAgo: number; supplierDoc?: LibraryDocument['supplierDoc']; archived?: LibraryDocument['archived'] },
  ) => {
    const r = resolve(record.kind, record.id);
    if (!r) return;
    const rnd = seeded(`${record.kind}:${record.id}:${d.title}`);
    docs.push({
      id: `doc-${String(++n).padStart(3, '0')}`,
      version: 1,
      title: d.title,
      fileName: d.fileName,
      mimeType: d.fileName.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf',
      sizeBytes: Math.round(80_000 + rnd() * 2_300_000),
      category: d.category,
      schemeIds: r.schemeIds,
      links: [r.link],
      visibility: d.visibility,
      uploadedAt: inDays(-d.uploadedAgo, 10, 0),
      uploadedBy: UPLOADERS[Math.floor(rnd() * UPLOADERS.length)],
      expiresAt: d.expiresAt,
      compliance: d.compliance,
      supplierDoc: d.supplierDoc,
      notes: d.notes,
      archived: d.archived,
    });
  };

  const year = new Date().getFullYear();
  for (const s of [...db.schemes.values()].filter((x) => x.organisationId === 'acacia')) {
    const r = seeded(`library:${s.id}`);
    const scheme = { kind: 'scheme' as const, id: s.id };
    const slug = s.code.toLowerCase();

    const ins = INSURANCE_EXPIRY[s.id] ?? 40 + Math.round(r() * 290);
    add(scheme, {
      title: `Building insurance policy ${year}`,
      fileName: `${slug}-insurance-schedule-${year}.pdf`,
      category: 'insurance',
      visibility: 'trustees',
      expiresAt: inDays(ins),
      compliance: 'building-insurance',
      notes: 'Policy schedule from the broker, with the replacement value.',
      uploadedAgo: 365 - ins,
    });
    const fire = FIRE_EXPIRY[s.id] ?? 30 + Math.round(r() * 300);
    add(scheme, {
      title: 'Fire equipment service certificate',
      fileName: `${slug}-fire-service.pdf`,
      category: 'certificate',
      visibility: 'trustees',
      expiresAt: inDays(fire),
      compliance: 'fire-equipment',
      uploadedAgo: 365 - fire,
    });
    if (LIFT_SCHEMES.includes(s.id)) {
      const lift = LIFT_EXPIRY[s.id] ?? 60 + Math.round(r() * 250);
      add(scheme, {
        title: 'Lift inspection certificate',
        fileName: `${slug}-lift-inspection.pdf`,
        category: 'certificate',
        visibility: 'trustees',
        expiresAt: inDays(lift),
        compliance: 'lift-inspection',
        uploadedAgo: 365 - lift,
      });
    }
    add(scheme, { title: 'Conduct rules', fileName: `${slug}-conduct-rules.pdf`, category: 'rules', visibility: 'owners', uploadedAgo: 200 + Math.round(r() * 400) });
  }

  // Kingfisher Court: last year's policy, replaced, and the plans.
  add({ kind: 'scheme', id: 'kingfisher-court' }, {
    title: `Building insurance policy ${year - 1}`,
    fileName: `kc-insurance-schedule-${year - 1}.pdf`,
    category: 'insurance',
    visibility: 'trustees',
    expiresAt: inDays(-40),
    compliance: 'building-insurance',
    uploadedAgo: 400,
    archived: { at: inDays(-45, 10, 0), by: 'Johan van der Merwe', reason: `Replaced by “Building insurance policy ${year}”` },
  });
  add({ kind: 'scheme', id: 'kingfisher-court' }, { title: 'Sectional plans (SG 1204/1998)', fileName: 'kc-sectional-plans.pdf', category: 'plans', visibility: 'trustees', uploadedAgo: 900 });

  // Supplier vetting documents: one per document on file.
  for (const sup of suppliers) {
    for (const d of sup.documents.filter((x) => x.onFile)) {
      add({ kind: 'supplier', id: sup.id }, {
        title: d.type,
        fileName: `${sup.id.replace('sup-', '')}-${d.type.split(' ')[0].toLowerCase()}.pdf`,
        category: 'vetting',
        visibility: 'staff',
        expiresAt: d.expires,
        supplierDoc: d.type,
        uploadedAgo: 30 + (n % 200),
      });
    }
  }

  // The demo story.
  const unit = (accountNo: string) => `unit-${accountNo.toLowerCase()}`;
  add({ kind: 'unit', id: unit('KC-042') }, { title: 'Levy clearance request from conveyancer', fileName: 'kc-042-clearance-request.pdf', category: 'correspondence', visibility: 'unit', uploadedAgo: 1, notes: 'Transfer to new owner; figures needed by Friday.' });
  add({ kind: 'unit', id: unit('KC-023') }, { title: 'Geyser installation certificate of compliance', fileName: 'kc-023-geyser-coc.pdf', category: 'certificate', visibility: 'unit', uploadedAgo: 420 });
  add({ kind: 'person', id: 'per-sipho' }, { title: 'Trustee consent to act', fileName: 'sipho-khumalo-trustee-consent.pdf', category: 'other', visibility: 'staff', uploadedAgo: 310 });
  if (jobs.some((j) => j.ref === 'MR-1012')) {
    add({ kind: 'job', id: 'MR-1012' }, { title: 'Plumber’s site report', fileName: 'mr-1012-site-report.pdf', category: 'correspondence', visibility: 'trustees', uploadedAgo: 8, notes: 'Geyser element and thermostat replaced; drip tray missing.' });
  }
  if (jobs.some((j) => j.ref === 'MR-1038')) {
    add({ kind: 'job', id: 'MR-1038' }, { title: 'Insurance claim decline letter', fileName: 'mr-1038-claim-declined.pdf', category: 'insurance', visibility: 'trustees', uploadedAgo: 6, notes: 'Declined as wear and tear.' });
  }
  return docs;
}
