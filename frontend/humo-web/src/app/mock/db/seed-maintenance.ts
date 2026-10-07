import { Invoice, Job, JobEvent, JobStage, PaymentBatch, Priority, Quote, Scheme, Supplier, SupplierDocType, Trade, Unit } from '../../domain';
import { formatRand } from '../../ui/format/money';
import { SCHEME_HEALTH } from '../fixtures/scheme-health';
import { SCHEMES } from '../fixtures/schemes';
import { personName } from '../fixtures/staff';
import { pick, round2, seeded } from './random';

function day(offset: number, hour = 9): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
}

// ===================================================================== Suppliers

const GP = SCHEMES.filter((s) => s.province === 'Gauteng').map((s) => s.id);
const KZN = SCHEMES.filter((s) => s.province === 'KwaZulu-Natal').map((s) => s.id);
const WC = SCHEMES.filter((s) => s.province === 'Western Cape').map((s) => s.id);

const ALL_DOCS: SupplierDocType[] = [
  'COIDA letter of good standing',
  'Public liability insurance',
  'Tax compliance (SARS PIN)',
  'B-BBEE certificate',
  'Bank confirmation letter',
];

interface SupplierSeed {
  id: string;
  name: string;
  trades: Trade[];
  contact: string;
  region: string[];
  /** Overrides: document type → days until expiry (negative = expired) or 'missing'. */
  docs?: Partial<Record<SupplierDocType, number | 'missing'>>;
  bankVerified?: boolean;
  onHold?: boolean;
}

const SUPPLIER_SEEDS: SupplierSeed[] = [
  { id: 'sup-rand-plumbing', name: 'Rand Plumbing & Drainage', trades: ['Plumbing'], contact: 'Moses Dlamini', region: GP, docs: { 'COIDA letter of good standing': 9 } },
  { id: 'sup-coastal-plumbers', name: 'Coastal Plumbers', trades: ['Plumbing'], contact: 'Rajen Pillay', region: KZN },
  { id: 'sup-cape-flow', name: 'Cape Flow Plumbing', trades: ['Plumbing'], contact: 'Ashley Jacobs', region: WC },
  { id: 'sup-bright-spark', name: 'Bright Spark Electrical', trades: ['Electrical'], contact: 'Thulani Zulu', region: GP, docs: { 'Public liability insurance': -6 } },
  { id: 'sup-volt-masters', name: 'Volt Masters', trades: ['Electrical'], contact: 'Kevin Naidoo', region: [...KZN, ...WC] },
  { id: 'sup-cape-seal', name: 'Cape Seal Waterproofing', trades: ['Roofing & waterproofing'], contact: 'Johan Steyn', region: [...GP, ...WC] },
  { id: 'sup-top-roof', name: 'Top Roof Contractors', trades: ['Roofing & waterproofing', 'Building'], contact: 'Sibusiso Mahlangu', region: GP },
  { id: 'sup-dryshield', name: 'DryShield Waterproofing', trades: ['Roofing & waterproofing'], contact: 'Liezl Kruger', region: GP },
  { id: 'sup-paintpro', name: 'PaintPro Gauteng', trades: ['Painting'], contact: 'Andile Ngcobo', region: GP },
  { id: 'sup-fresh-coat', name: 'Fresh Coat Painters', trades: ['Painting'], contact: 'Megan Clarke', region: [...GP, ...KZN] },
  { id: 'sup-secure-rite', name: 'Secure-Rite Security', trades: ['Security'], contact: 'Patrick Moyo', region: GP },
  { id: 'sup-gate-automation', name: 'Gate Automation SA', trades: ['Gate automation'], contact: 'Ruan du Plessis', region: GP },
  { id: 'sup-autogate', name: 'AutoGate Pro', trades: ['Gate automation', 'Security'], contact: 'Imran Moosa', region: [...GP, ...KZN] },
  { id: 'sup-liftco', name: 'Liftco Elevators', trades: ['Lifts'], contact: 'Daniel Ferreira', region: [...GP, ...WC, ...KZN] },
  { id: 'sup-greenleaf', name: 'GreenLeaf Garden Services', trades: ['Gardens'], contact: 'Precious Mabaso', region: [...GP, ...KZN], docs: { 'Bank confirmation letter': 'missing' }, bankVerified: false },
  { id: 'sup-aquacare', name: 'AquaCare Pools', trades: ['Pools'], contact: 'Werner Venter', region: GP },
  { id: 'sup-pestaway', name: 'PestAway Hygiene', trades: ['Pest control'], contact: 'Nomvula Radebe', region: [...GP, ...KZN, ...WC] },
  { id: 'sup-mabaso-building', name: 'Mabaso Building & Maintenance', trades: ['Building', 'Painting', 'Plumbing'], contact: 'Themba Mabaso', region: GP },
  { id: 'sup-solid-ground', name: 'Solid Ground Engineering', trades: ['Building'], contact: 'Dr. Elmarie Botha', region: GP },
  { id: 'sup-firesafe', name: 'FireSafe Compliance', trades: ['Fire equipment'], contact: 'Yusuf Essop', region: [...GP, ...KZN, ...WC] },
  { id: 'sup-abc-gates', name: 'ABC Gates & Automation', trades: ['Gate automation', 'Security'], contact: 'Sizwe Ndaba', region: GP },
  { id: 'sup-xyz-security', name: 'XYZ Security Solutions', trades: ['Security', 'Gate automation'], contact: 'Charl Pretorius', region: GP },
  { id: 'sup-kzn-handyman', name: 'Umgeni Handyman Services', trades: ['Building', 'Painting', 'Electrical'], contact: 'Lwazi Shabalala', region: KZN, onHold: true, docs: { 'Tax compliance (SARS PIN)': -40 } },
];

export function seedSuppliers(): Supplier[] {
  return SUPPLIER_SEEDS.map((s) => {
    const r = seeded('supplier-' + s.id);
    const documents = ALL_DOCS.map((type) => {
      const o = s.docs?.[type];
      if (o === 'missing') return { type, onFile: false };
      const days = typeof o === 'number' ? o : type === 'Bank confirmation letter' ? undefined : 60 + Math.round(r() * 300);
      return { type, onFile: true, expires: days === undefined ? undefined : day(days) };
    });
    const slug = s.name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
    return {
      id: s.id,
      // Every supplier in the demo is also a business on Humo Contractor.
      partyId: `party-${s.id.replace(/^sup-/, '')}`,
      name: s.name,
      trades: s.trades,
      contactName: s.contact,
      phone: `0${pick(r, ['11', '12', '31', '21', '82', '83', '72'])} ${Math.floor(100 + r() * 900)} ${Math.floor(1000 + r() * 9000)}`,
      email: `jobs@${slug}.example`,
      bankAccount: `${pick(r, ['FNB', 'Standard Bank', 'Nedbank', 'ABSA', 'Capitec Business'])} ••${Math.floor(1000 + r() * 9000)}`,
      bankVerified: s.bankVerified ?? true,
      bbbeeLevel: 1 + Math.floor(r() * 4),
      schemeIds: s.region,
      documents,
      performance: {
        jobsCompleted: 12 + Math.floor(r() * 140),
        onTimeRate: Math.round(72 + r() * 26),
        avgVariance: Math.round((r() * 6 - 1) * 10) / 10,
        verifiedRate: Math.round(80 + r() * 19),
      },
      status: s.onHold ? 'on-hold' : 'active',
    } satisfies Supplier;
  });
}

// ===================================================================== Jobs

const TITLES: Partial<Record<Trade, string[]>> = {
  Plumbing: ['Leaking kitchen tap', 'Blocked bathroom drain', 'Low water pressure', 'Burst irrigation pipe', 'Geyser not heating'],
  Electrical: ['Passage lights not working', 'DB board keeps tripping', 'Faulty plug point in garage', 'Security light timer faulty'],
  'Roofing & waterproofing': ['Roof leak after storm', 'Damp patch on ceiling', 'Blocked gutters'],
  Painting: ['Peeling paint on boundary wall', 'Repaint entrance foyer'],
  Security: ['Electric fence zone faulty', 'CCTV camera offline'],
  'Gate automation': ['Pedestrian gate not closing', 'Vehicle gate remote not working'],
  Gardens: ['Tree branch over driveway', 'Irrigation leak near Block A'],
  'Pest control': ['Ants in kitchen', 'Rodents in refuse area'],
  Building: ['Cracked paving at entrance', 'Loose balustrade on stairs'],
};

const SUPPLIERS_BY_TRADE = (trade: Trade, schemeId: string, all: Supplier[]) =>
  all.filter((s) => s.trades.includes(trade) && s.schemeIds.includes(schemeId) && s.status === 'active');

interface JobSeed {
  ref: string;
  schemeId: string;
  unitAccountNo?: string;
  location: string;
  title: string;
  description: string;
  category: Trade;
  priority: Priority;
  stage: JobStage;
  reportedAgo: number;
  reportedBy: Job['reportedBy'];
  quotes?: { supplierId: string; amount?: number; recommended?: boolean; guaranteeMonths?: number; notes?: string }[];
  approvalWorkItemId?: string;
  supplierId?: string;
  withinDelegation?: boolean;
  scheduledIn?: number;
  invoiceId?: string;
  photos?: string[];
  dueIn?: number;
  completion?: string;
}

const NAMED_JOBS: JobSeed[] = [
  {
    ref: 'MR-1012', schemeId: 'kingfisher-court', unitAccountNo: 'KC-023', location: 'Unit 23 — kitchen', category: 'Plumbing', priority: 'urgent',
    title: 'Leaking geyser, Unit 23', description: 'Geyser overflow pipe leaking into the kitchen ceiling of Unit 19 below. Water switched off at the isolator by the owner.',
    stage: 'scheduled', reportedAgo: 9, reportedBy: { name: 'Nadia Abrahams', role: 'owner', personId: 'per-kc23' },
    quotes: [{ supplierId: 'sup-rand-plumbing', amount: 4650, recommended: true, guaranteeMonths: 12, notes: 'Replace pressure valve and drip tray, reseal overflow.' }],
    supplierId: 'sup-rand-plumbing', withinDelegation: true, scheduledIn: -6, dueIn: -5,
    photos: ['Water stain on Unit 19 ceiling', 'Geyser overflow pipe dripping'],
  },
  {
    ref: 'MR-1042', schemeId: 'kingfisher-court', location: 'Roof above Block C (Units 41–44)', category: 'Roofing & waterproofing', priority: 'high',
    title: 'Roof waterproofing above Units 41–44', description: 'Recurring leaks into top-floor units of Block C after heavy rain. Membrane has failed along the parapet.',
    stage: 'approval', reportedAgo: 24, reportedBy: { name: 'Anele Mthembu', role: 'owner', personId: 'per-anele' },
    quotes: [
      { supplierId: 'sup-cape-seal', amount: 68500, recommended: true, guaranteeMonths: 60, notes: 'Torch-on membrane, 5-year guarantee.' },
      { supplierId: 'sup-dryshield', amount: 74200, guaranteeMonths: 36, notes: 'Liquid membrane system.' },
      { supplierId: 'sup-top-roof', amount: 81900, guaranteeMonths: 24 },
    ],
    approvalWorkItemId: 'w13', photos: ['Failed membrane at parapet', 'Ceiling damage in Unit 43', 'Ponding water on roof'],
  },
  {
    ref: 'MR-1051', schemeId: 'kingfisher-court', location: 'Stairwell B', category: 'Painting', priority: 'low',
    title: 'Repaint stairwell B', description: 'Planned maintenance item from the 10-year maintenance plan.',
    stage: 'approval', reportedAgo: 30, reportedBy: { name: 'Johan van der Merwe', role: 'staff' },
    quotes: [
      { supplierId: 'sup-paintpro', amount: 24300, recommended: true, guaranteeMonths: 12 },
      { supplierId: 'sup-fresh-coat', amount: 26950, guaranteeMonths: 12 },
      { supplierId: 'sup-mabaso-building', amount: 29100, guaranteeMonths: 6 },
    ],
    approvalWorkItemId: 'w15',
  },
  {
    ref: 'MR-1038', schemeId: 'the-willows', location: 'Main entrance gate', category: 'Gate automation', priority: 'urgent',
    title: 'Replace main gate motor', description: 'Motor burnt out after a power surge. Gate is on manual — guards opening by hand.',
    stage: 'approval', reportedAgo: 5, reportedBy: { name: 'Johan van der Merwe', role: 'staff' },
    quotes: [
      { supplierId: 'sup-gate-automation', amount: 18900, recommended: true, guaranteeMonths: 24 },
      { supplierId: 'sup-autogate', amount: 21400, guaranteeMonths: 12 },
    ],
    approvalWorkItemId: 'w14', photos: ['Burnt motor control board'],
  },
  {
    ref: 'MR-1029', schemeId: 'lonehill-village', location: 'Clubhouse kitchen', category: 'Roofing & waterproofing', priority: 'high',
    title: 'Clubhouse roof repair', description: 'Leak above the clubhouse kitchen. Temporary tarp in place.',
    stage: 'approval', reportedAgo: 16, reportedBy: { name: 'Johan van der Merwe', role: 'staff' },
    quotes: [
      { supplierId: 'sup-top-roof', amount: 42750, recommended: true, guaranteeMonths: 24 },
      { supplierId: 'sup-dryshield', amount: 47900, guaranteeMonths: 36 },
    ],
    approvalWorkItemId: 'w16',
  },
  {
    ref: 'MR-1019', schemeId: 'northcliff-view', location: 'Pool area', category: 'Pools', priority: 'high',
    title: 'Pool pump failure', description: 'Pump seized; pool green since 28 Sep. Replacement part on order from the supplier.',
    stage: 'in-progress', reportedAgo: 10, reportedBy: { name: 'Johan van der Merwe', role: 'staff' },
    quotes: [{ supplierId: 'sup-aquacare', amount: 3980, recommended: true }], supplierId: 'sup-aquacare', withinDelegation: true, scheduledIn: -4, dueIn: -2,
  },
  {
    ref: 'MR-1060', schemeId: 'morningside-manor', unitAccountNo: 'MM-003', location: 'Unit 3 — main bedroom ceiling', category: 'Plumbing', priority: 'high',
    title: 'Water damage in Unit 3 ceiling', description: 'Brown stain spreading on the bedroom ceiling. Possibly from Unit 7 above.',
    stage: 'reported', reportedAgo: 0, reportedBy: { name: 'Grace Mahlangu', role: 'owner', personId: 'per-grace' },
    photos: ['Ceiling stain (wide)', 'Ceiling stain (close-up)', 'Bathroom above'],
  },
  {
    ref: 'MR-1061', schemeId: 'kingfisher-court', location: 'Block A entrance', category: 'Security', priority: 'normal',
    title: 'Intercom not working — Block A', description: 'Reported by three residents this morning. Visitors can’t call units.',
    stage: 'reported', reportedAgo: 0, reportedBy: { name: 'Ruan Botha', role: 'tenant', personId: 'per-ruan' },
  },
  {
    // Quotes requested through Humo Contractor: see the contractor network's QR-2041.
    ref: 'MR-1070', schemeId: 'kingfisher-court', location: 'Main vehicle entrance', category: 'Gate automation', priority: 'high',
    title: 'Replace damaged entrance gate', description: 'A delivery truck reversed into the main gate. The leaf is bent and the motor bracket sheared; the gate is chained open and guarded at night.',
    stage: 'quoting', reportedAgo: 6, reportedBy: { name: 'Johan van der Merwe', role: 'staff' },
    photos: ['Bent gate leaf', 'Sheared motor bracket', 'Gate chained open'], dueIn: 23,
  },
  {
    ref: 'MR-0998', schemeId: 'benoni-lakeside', location: 'Northern boundary wall', category: 'Building', priority: 'high',
    title: 'Boundary wall crack', description: 'Vertical crack widening along the northern wall. Structural engineer report requested before quotes.',
    stage: 'quoting', reportedAgo: 21, reportedBy: { name: 'Kabelo Molefe', role: 'staff' },
    quotes: [{ supplierId: 'sup-solid-ground' }, { supplierId: 'sup-top-roof' }], dueIn: -8,
  },
  {
    ref: 'MR-1007', schemeId: 'centurion-palms', location: 'Internal road, near Unit 30', category: 'Electrical', priority: 'normal',
    title: 'Streetlight repair, internal road', description: 'Two streetlights out. Electrician did not arrive on 4 Oct.',
    stage: 'scheduled', reportedAgo: 12, reportedBy: { name: 'Naledi Sithole', role: 'staff' },
    quotes: [{ supplierId: 'sup-bright-spark', amount: 2350, recommended: true }], supplierId: 'sup-bright-spark', withinDelegation: true, scheduledIn: -3, dueIn: -1,
  },
  {
    ref: 'MR-1033', schemeId: 'kingfisher-court', unitAccountNo: 'KC-017', location: 'Passage outside Unit 17', category: 'Electrical', priority: 'normal',
    title: 'Passage light outside Unit 17', description: 'Light fitting flickering and then failed.',
    stage: 'completed', reportedAgo: 8, reportedBy: { name: 'Ruan Botha', role: 'tenant', personId: 'per-ruan' },
    quotes: [{ supplierId: 'sup-bright-spark', amount: 980, recommended: true }], supplierId: 'sup-bright-spark', withinDelegation: true, scheduledIn: -2,
    completion: 'Replaced fitting and LED driver. Tested OK.',
  },
  {
    ref: 'MR-1003', schemeId: 'the-willows', unitAccountNo: 'TW-023', location: 'Unit 23 — roof space', category: 'Plumbing', priority: 'urgent',
    title: 'Geyser replacement, Unit 23', description: 'Geyser burst. Insurance claim declined (wear and tear) — body corporate geyser per conduct rules.',
    stage: 'invoiced', reportedAgo: 18, reportedBy: { name: 'Johan van der Merwe', role: 'staff' },
    quotes: [{ supplierId: 'sup-rand-plumbing', amount: 14850, recommended: true, guaranteeMonths: 24 }], supplierId: 'sup-rand-plumbing', scheduledIn: -9,
    invoiceId: 'INV-20951', completion: 'New 150L geyser installed with drip tray and vacuum breakers. CoC issued.',
  },
  {
    ref: 'MR-0990', schemeId: 'rosebank-terraces', location: 'Lift (Block A)', category: 'Lifts', priority: 'urgent',
    title: 'Lift motor repair', description: 'Lift out of service — motor bearing failure.',
    stage: 'invoiced', reportedAgo: 26, reportedBy: { name: 'Johan van der Merwe', role: 'staff' },
    quotes: [{ supplierId: 'sup-liftco', amount: 27800, recommended: true }], supplierId: 'sup-liftco', scheduledIn: -14,
    invoiceId: 'INV-20960', completion: 'Motor bearing and an additional worn sheave bearing replaced. Lift recommissioned.',
  },
];

export interface MaintenanceSeed {
  suppliers: Supplier[];
  jobs: Job[];
  invoices: Invoice[];
  batches: PaymentBatch[];
}

export function seedMaintenance(units: Unit[]): MaintenanceSeed {
  const suppliers = seedSuppliers();
  const jobs: Job[] = [];
  const invoices: Invoice[] = [];
  const schemes = new Map(SCHEMES.map((s) => [s.id, s]));
  const unitByAccount = new Map(units.map((u) => [u.accountNo, u]));

  const buildJob = (s: JobSeed): Job => {
    const scheme = schemes.get(s.schemeId)!;
    const unit = s.unitAccountNo ? unitByAccount.get(s.unitAccountNo) : undefined;
    const reportedAt = day(-s.reportedAgo, 8);
    const quotes: Quote[] = (s.quotes ?? []).map((q, i) => ({
      id: `${s.ref}-q${i + 1}`,
      supplierId: q.supplierId,
      amount: q.amount ?? 0,
      status: q.amount ? 'received' : 'requested',
      receivedAt: q.amount ? day(-Math.max(0, s.reportedAgo - 3 - i), 14) : undefined,
      validUntil: q.amount ? day(30) : undefined,
      guaranteeMonths: q.guaranteeMonths,
      notes: q.notes,
      recommended: q.recommended,
    }));
    const recommended = quotes.find((q) => q.recommended);
    const job: Job = {
      id: 'job-' + s.ref.toLowerCase(),
      ref: s.ref,
      schemeId: s.schemeId,
      unitId: unit?.id,
      location: s.location,
      title: s.title,
      description: s.description,
      category: s.category,
      priority: s.priority,
      stage: s.stage,
      reportedBy: s.reportedBy,
      reportedAt,
      assigneeId: s.stage === 'reported' ? null : scheme.portfolioManagerId,
      photos: (s.photos ?? []).map((caption, i) => ({ id: `${s.ref}-p${i + 1}`, caption, takenAt: reportedAt, by: s.reportedBy.name, stage: 'report' })),
      quotes,
      supplierId: s.supplierId,
      budgetCategory: `Maintenance — ${s.category.toLowerCase()}`,
      events: [],
      dueAt: s.dueIn !== undefined ? day(s.dueIn, 17) : undefined,
      invoiceId: s.invoiceId,
    };
    const afterApproval = ['approved', 'scheduled', 'in-progress', 'completed', 'verified', 'invoiced', 'paid', 'closed'].includes(s.stage);
    if (s.stage === 'approval') {
      job.approval = { status: 'pending', workItemId: s.approvalWorkItemId };
    } else if (afterApproval && recommended) {
      const by = s.withinDelegation ? personName(scheme.portfolioManagerId) : 'Trustees (2 of 3)';
      job.approval = { status: 'approved', decidedBy: by, decidedAt: day(-s.reportedAgo + 2, 15), withinDelegation: !!s.withinDelegation };
    }
    if (afterApproval && s.scheduledIn !== undefined) {
      job.workOrder = { issuedAt: day(-s.reportedAgo + 3, 10), scheduledFor: day(s.scheduledIn, 9), accessNotes: unit ? 'Owner will be home; call 30 minutes before.' : 'Collect keys from the guardhouse.' };
    }
    if (['completed', 'verified', 'invoiced', 'paid', 'closed'].includes(s.stage)) {
      job.completion = { completedAt: day((s.scheduledIn ?? -2) + 0, 15), notes: s.completion ?? 'Work completed.' };
      job.photos.push({ id: `${s.ref}-c1`, caption: 'Completed work', takenAt: job.completion.completedAt, by: 'Supplier', stage: 'completion' });
    }
    if (['verified', 'invoiced', 'paid', 'closed'].includes(s.stage)) {
      job.verification = { at: day((s.scheduledIn ?? -2) + 1, 12), by: unit ? 'Owner' : personName(scheme.portfolioManagerId), outcome: 'fixed' };
    }
    job.events = history(job, suppliers);
    return job;
  };

  for (const s of NAMED_JOBS) jobs.push(buildJob(s));

  // Generated jobs so each scheme's open-job count matches its health figures.
  let seq = 1100;
  for (const scheme of SCHEMES) {
    const health = SCHEME_HEALTH.find((h) => h.schemeId === scheme.id)!;
    const r = seeded('jobs-' + scheme.id);
    const schemeUnits = units.filter((u) => u.schemeId === scheme.id);
    const open = jobs.filter((j) => j.schemeId === scheme.id && !['paid', 'closed', 'cancelled'].includes(j.stage)).length;
    const toMake = Math.max(0, health.openJobs - open);
    const stages: JobStage[] = ['reported', 'quoting', 'quoting', 'scheduled', 'in-progress', 'completed'];
    for (let i = 0; i < toMake + 3; i++) {
      const closed = i >= toMake;
      const trades = Object.keys(TITLES) as Trade[];
      let category = pick(r, trades);
      let candidates = SUPPLIERS_BY_TRADE(category, scheme.id, suppliers);
      if (!candidates.length) {
        category = 'Plumbing';
        candidates = SUPPLIERS_BY_TRADE(category, scheme.id, suppliers);
      }
      const unit = r() < 0.55 ? schemeUnits[Math.floor(r() * schemeUnits.length)] : undefined;
      const stage: JobStage = closed ? 'closed' : pick(r, stages);
      const supplier = candidates[0];
      const amount = Math.round(650 + r() * 4100);
      const ref = `MR-${++seq}`;
      const job = buildJob({
        ref,
        schemeId: scheme.id,
        unitAccountNo: unit?.accountNo,
        location: unit ? `Unit ${unit.number}` : pick(r, ['Common property', 'Parking area', 'Entrance', 'Garden', 'Refuse area']),
        title: pick(r, TITLES[category]!),
        description: 'Logged via the owner portal.',
        category,
        priority: pick(r, ['normal', 'normal', 'high', 'low'] as Priority[]),
        stage,
        reportedAgo: closed ? 30 + Math.floor(r() * 120) : 1 + Math.floor(r() * 12),
        reportedBy: unit ? { name: 'Owner', role: 'owner' } : { name: personName(scheme.portfolioManagerId), role: 'staff' },
        quotes: stage === 'reported' ? [] : stage === 'quoting' ? [{ supplierId: supplier?.id ?? 'sup-mabaso-building' }] : [{ supplierId: supplier?.id ?? 'sup-mabaso-building', amount, recommended: true }],
        supplierId: ['scheduled', 'in-progress', 'completed', 'closed'].includes(stage) ? supplier?.id : undefined,
        withinDelegation: true,
        scheduledIn: stage === 'scheduled' ? 1 + Math.floor(r() * 6) : -2 - Math.floor(r() * 10),
        completion: 'Work completed and tested.',
      });
      if (closed && supplier) {
        const inv: Invoice = {
          id: `INV-${19000 + jobs.length}`,
          supplierId: supplier.id,
          schemeId: scheme.id,
          jobId: job.id,
          description: job.title,
          amount,
          approvedAmount: amount,
          receivedAt: day(-25 - Math.floor(r() * 60)),
          dueAt: day(-10),
          status: 'paid',
          paidAt: day(-5 - Math.floor(r() * 50)),
        };
        job.invoiceId = inv.id;
        invoices.push(inv);
        job.events = history(job, suppliers);
      }
      jobs.push(job);
    }
  }

  // ---- Invoices tied to the Approvals queue ----
  invoices.push(
    { id: 'INV-20951', supplierId: 'sup-rand-plumbing', schemeId: 'the-willows', jobId: 'job-mr-1003', description: 'Geyser replacement, Unit 23', amount: 14850, approvedAmount: 14850, receivedAt: day(-3), dueAt: day(27), status: 'awaiting-approval', approvalWorkItemId: 'w10' },
    { id: 'INV-20960', supplierId: 'sup-liftco', schemeId: 'rosebank-terraces', jobId: 'job-mr-0990', description: 'Lift motor repair (Block A)', amount: 31200, approvedAmount: 27800, receivedAt: day(-6), dueAt: day(24), status: 'awaiting-approval', approvalWorkItemId: 'w12' },
    { id: 'INV-20944', supplierId: 'sup-secure-rite', schemeId: 'kingfisher-court', contractRef: 'SEC-2025-03', description: 'Guarding services — October', amount: 21450, receivedAt: day(-2), dueAt: day(28), status: 'awaiting-approval', approvalWorkItemId: 'w09' },
    { id: 'INV-20957', supplierId: 'sup-greenleaf', schemeId: 'ballito-dunes', contractRef: 'GL-2024-11', description: 'Garden services — October', amount: 9800, receivedAt: day(-2), dueAt: day(28), status: 'awaiting-approval', approvalWorkItemId: 'w11' },
  );

  // ---- Payment batch PB-0412 (Kingfisher Court): nine approved invoices = R 58 940.20 ----
  const batchItems: [string, string, number][] = [
    ['sup-secure-rite', 'Guarding services — September', 21450],
    ['sup-pestaway', 'Quarterly pest control', 3850],
    ['sup-liftco', 'Lift maintenance contract — Q3', 6900],
    ['sup-mabaso-building', 'Repair paving at entrance', 4320.5],
    ['sup-bright-spark', 'Replace passage lights Block B', 5185],
    ['sup-rand-plumbing', 'Clear blocked stormwater drain', 2760],
    ['sup-paintpro', 'Touch-up paint, guardhouse', 3410.7],
    ['sup-firesafe', 'Fire extinguisher service', 2964],
  ];
  const sum = batchItems.reduce((s, b) => s + b[2], 0);
  batchItems.push(['sup-cape-seal', 'Roof inspection report', round2(58940.2 - sum)]);
  const batchInvoiceIds = batchItems.map(([supplierId, description, amount], i) => {
    const id = `INV-2083${i}`;
    invoices.push({ id, supplierId, schemeId: 'kingfisher-court', description, amount, receivedAt: day(-14 + i), dueAt: day(7), status: 'in-batch', batchId: 'PB-0412', contractRef: 'Sundry' });
    return id;
  });
  const batches: PaymentBatch[] = [
    { id: 'PB-0412', schemeId: 'kingfisher-court', invoiceIds: batchInvoiceIds, total: 58940.2, createdAt: day(-1, 16), createdBy: 'Priya Naidoo', status: 'awaiting-approval', approvalWorkItemId: 'w08' },
  ];

  // A few approved invoices ready for the next batch.
  invoices.push(
    { id: 'INV-20970', supplierId: 'sup-aquacare', schemeId: 'kingfisher-court', description: 'Pool chemicals — October', amount: 1240, receivedAt: day(-4), dueAt: day(26), status: 'approved', contractRef: 'Sundry' },
    { id: 'INV-20972', supplierId: 'sup-pestaway', schemeId: 'the-willows', description: 'Rodent baiting, refuse area', amount: 1680, receivedAt: day(-5), dueAt: day(25), status: 'approved', contractRef: 'Sundry' },
  );

  return { suppliers, jobs, invoices, batches };
}

/** Rebuilds a job's activity log from its state (seed data only; live changes append events). */
function history(job: Job, suppliers: Supplier[]): JobEvent[] {
  const name = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? 'Supplier';
  const ev: JobEvent[] = [];
  const add = (at: string, kind: JobEvent['kind'], text: string, by: string) => ev.push({ id: `${job.ref}-e${ev.length + 1}`, at, kind, text, by });
  add(job.reportedAt, 'stage', `Reported by ${job.reportedBy.name}${job.reportedBy.role !== 'staff' ? ` (${job.reportedBy.role})` : ''}`, job.reportedBy.name);
  if (job.assigneeId) add(new Date(new Date(job.reportedAt).getTime() + 3_600_000).toISOString(), 'stage', `Assigned to ${personName(job.assigneeId)}`, 'Humo');
  for (const q of job.quotes) {
    add(new Date(new Date(job.reportedAt).getTime() + 7_200_000).toISOString(), 'quote', `Quote requested from ${name(q.supplierId)}`, personName(job.assigneeId));
    if (q.status === 'received' && q.receivedAt) add(q.receivedAt, 'quote', `Quote received from ${name(q.supplierId)}: ${formatRand(q.amount)}`, name(q.supplierId));
  }
  if (job.approval?.status === 'pending') add(new Date().toISOString(), 'approval', 'Sent for trustee approval', personName(job.assigneeId));
  if (job.approval?.status === 'approved' && job.approval.decidedAt)
    add(job.approval.decidedAt, 'approval', job.approval.withinDelegation ? `Approved within delegated authority by ${job.approval.decidedBy}` : `Approved by ${job.approval.decidedBy}`, job.approval.decidedBy ?? '');
  if (job.workOrder) add(job.workOrder.issuedAt, 'stage', `Work order issued to ${name(job.supplierId)} for ${new Date(job.workOrder.scheduledFor).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}`, personName(job.assigneeId));
  if (job.completion) add(job.completion.completedAt, 'stage', `Completed: ${job.completion.notes}`, name(job.supplierId));
  if (job.verification) add(job.verification.at, 'stage', `Verified as fixed by ${job.verification.by}`, job.verification.by);
  if (job.invoiceId) add(new Date(new Date(job.verification?.at ?? job.reportedAt).getTime() + 86_400_000).toISOString(), 'invoice', `Invoice ${job.invoiceId} received`, name(job.supplierId));
  if (job.stage === 'closed') add(new Date(new Date(job.reportedAt).getTime() + 20 * 86_400_000).toISOString(), 'payment', 'Paid and closed', 'Humo');
  return ev.sort((a, b) => b.at.localeCompare(a.at));
}

export function schemeFor(id: string): Scheme {
  return SCHEMES.find((s) => s.id === id)!;
}
