import {
  ContractorDocument,
  ContractorEndorsement,
  ContractorProfile,
  ContractorQuote,
  QuoteLifecycleEvent,
  QuoteRequest,
  ServiceCategory,
  VerificationLevel,
  WorkOrder,
} from '../../domain/contractor';
import { seeded } from '../db/random';

/**
 * The Humo Contractor network's own data. It does not import anything from
 * Humo PM's mock data: it's the registry a standalone product would own.
 * Humo PM suppliers point at these parties by id.
 */
const day = (d: number, hour = 9) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  x.setHours(hour, 0, 0, 0);
  return x.toISOString();
};

interface PartySeed {
  id: string;
  name: string;
  categories: ServiceCategory[];
  contact: string;
  province: string;
  areas: string[];
  level?: VerificationLevel;
  rep?: Partial<ContractorProfile['reputation']>;
  endorsements?: number;
  /** Explicit endorsers (customer ids), newest first — each must be a real past customer. */
  endorsedBy?: string[];
  established?: number;
}

const GP = ['Johannesburg North', 'Johannesburg South', 'Tshwane', 'Ekurhuleni'];
const KZN = ['eThekwini', 'Umhlanga & Ballito'];
const WC = ['Cape Town Metro', 'Winelands'];

const PARTIES: PartySeed[] = [
  {
    id: 'party-secureaccess', name: 'SecureAccess Systems', categories: ['Gate automation', 'Security'], contact: 'Themba Khoza', province: 'Gauteng', areas: GP,
    level: 'verified', established: 2014, endorsements: 12,
    endorsedBy: ['tshikrand', 'cust-oakridge', 'cust-greenfields', 'umgeni', 'cust-011', 'cust-012', 'cust-014', 'cust-031', 'cust-032', 'cust-034', 'cust-035', 'cust-019'],
    rep: { rating: 4.8, ratingsCount: 31, completedJobs: 28, completionRate: 100, onTimeRate: 93, quoteResponseRate: 96, medianResponseHours: 19, humoRelationships: 9 },
  },
  {
    id: 'party-abc-gates', name: 'ABC Gates & Automation', categories: ['Gate automation', 'Security'], contact: 'Sizwe Ndaba', province: 'Gauteng', areas: GP,
    level: 'verified', established: 2009, endorsements: 7,
    rep: { rating: 4.6, ratingsCount: 44, completedJobs: 41, completionRate: 98, onTimeRate: 88, quoteResponseRate: 91, medianResponseHours: 30, humoRelationships: 6 },
  },
  {
    id: 'party-xyz-security', name: 'XYZ Security Solutions', categories: ['Security', 'Gate automation'], contact: 'Charl Pretorius', province: 'Gauteng', areas: ['Johannesburg North', 'Tshwane'],
    level: 'listed', established: 2019, endorsements: 2,
    rep: { rating: 4.3, ratingsCount: 15, completedJobs: 17, completionRate: 94, onTimeRate: 82, quoteResponseRate: 78, medianResponseHours: 52, humoRelationships: 3 },
  },
  {
    id: 'party-rand-plumbing', name: 'Rand Plumbing & Drainage', categories: ['Plumbing'], contact: 'Moses Dlamini', province: 'Gauteng', areas: GP,
    level: 'recommended', established: 2006, endorsements: 12,
    rep: { rating: 4.8, ratingsCount: 36, completedJobs: 38, completionRate: 97, onTimeRate: 96, quoteResponseRate: 94, medianResponseHours: 14, humoRelationships: 8 },
  },
  { id: 'party-coastal-plumbers', name: 'Coastal Plumbers', categories: ['Plumbing'], contact: 'Rajen Pillay', province: 'KwaZulu-Natal', areas: KZN },
  { id: 'party-cape-flow', name: 'Cape Flow Plumbing', categories: ['Plumbing'], contact: 'Ashley Jacobs', province: 'Western Cape', areas: WC },
  { id: 'party-bright-spark', name: 'Bright Spark Electrical', categories: ['Electrical'], contact: 'Thulani Zulu', province: 'Gauteng', areas: GP, level: 'listed' },
  { id: 'party-volt-masters', name: 'Volt Masters', categories: ['Electrical'], contact: 'Kevin Naidoo', province: 'KwaZulu-Natal', areas: [...KZN, ...WC] },
  { id: 'party-cape-seal', name: 'Cape Seal Waterproofing', categories: ['Roofing & waterproofing'], contact: 'Johan Steyn', province: 'Gauteng', areas: [...GP, ...WC] },
  { id: 'party-top-roof', name: 'Top Roof Contractors', categories: ['Roofing & waterproofing', 'Building'], contact: 'Sibusiso Mahlangu', province: 'Gauteng', areas: GP },
  { id: 'party-dryshield', name: 'DryShield Waterproofing', categories: ['Roofing & waterproofing'], contact: 'Liezl Kruger', province: 'Gauteng', areas: GP },
  { id: 'party-paintpro', name: 'PaintPro Gauteng', categories: ['Painting'], contact: 'Andile Ngcobo', province: 'Gauteng', areas: GP },
  { id: 'party-fresh-coat', name: 'Fresh Coat Painters', categories: ['Painting'], contact: 'Megan Clarke', province: 'Gauteng', areas: [...GP, ...KZN] },
  { id: 'party-secure-rite', name: 'Secure-Rite Security', categories: ['Security'], contact: 'Patrick Moyo', province: 'Gauteng', areas: GP },
  { id: 'party-gate-automation', name: 'Gate Automation SA', categories: ['Gate automation'], contact: 'Ruan du Plessis', province: 'Gauteng', areas: GP },
  { id: 'party-autogate', name: 'AutoGate Pro', categories: ['Gate automation', 'Security'], contact: 'Imran Moosa', province: 'Gauteng', areas: [...GP, ...KZN] },
  { id: 'party-liftco', name: 'Liftco Elevators', categories: ['Lifts'], contact: 'Daniel Ferreira', province: 'Gauteng', areas: [...GP, ...WC, ...KZN] },
  { id: 'party-greenleaf', name: 'GreenLeaf Garden Services', categories: ['Gardens'], contact: 'Precious Mabaso', province: 'Gauteng', areas: [...GP, ...KZN], level: 'listed' },
  { id: 'party-aquacare', name: 'AquaCare Pools', categories: ['Pools'], contact: 'Werner Venter', province: 'Gauteng', areas: GP },
  { id: 'party-pestaway', name: 'PestAway Hygiene', categories: ['Pest control'], contact: 'Nomvula Radebe', province: 'Gauteng', areas: [...GP, ...KZN, ...WC] },
  { id: 'party-mabaso-building', name: 'Mabaso Building & Maintenance', categories: ['Building', 'Painting', 'Plumbing'], contact: 'Themba Mabaso', province: 'Gauteng', areas: GP },
  { id: 'party-solid-ground', name: 'Solid Ground Engineering', categories: ['Building'], contact: 'Dr. Elmarie Botha', province: 'Gauteng', areas: GP },
  { id: 'party-firesafe', name: 'FireSafe Compliance', categories: ['Fire equipment'], contact: 'Yusuf Essop', province: 'Gauteng', areas: [...GP, ...KZN, ...WC] },
  { id: 'party-kzn-handyman', name: 'Umgeni Handyman Services', categories: ['Building', 'Painting', 'Electrical'], contact: 'Lwazi Shabalala', province: 'KwaZulu-Natal', areas: KZN, level: 'listed' },
];

/** Humo customers who endorse contractors (organisations, never anonymous people). */
const ENDORSERS = [
  { id: 'tshikrand', name: 'Tshikrand', person: 'Operations Manager' },
  { id: 'acacia', name: 'Acacia Managing Agents', person: 'Thandeka Mokoena' },
  { id: 'umgeni', name: 'Umgeni BC Services', person: 'Sbu Mkhize' },
  { id: 'cust-oakridge', name: 'Oakridge Managing Agents', person: 'Portfolio Manager' },
  { id: 'cust-greenfields', name: 'Greenfields Property Management', person: 'Agency Administrator' },
  { id: 'cust-011', name: 'Sandton Managing Agents', person: 'Portfolio Manager' },
  { id: 'cust-012', name: 'Midrand Property Management', person: 'Agency Administrator' },
  { id: 'cust-014', name: 'Centurion Estate Administrators', person: 'Portfolio Manager' },
  { id: 'cust-031', name: 'Fourways Body Corporate Services', person: 'Operations Lead' },
  { id: 'cust-032', name: 'Bryanston Managing Agents', person: 'Portfolio Manager' },
  { id: 'cust-034', name: 'Boksburg Property Management', person: 'Agency Administrator' },
  { id: 'cust-035', name: 'Bedfordview Estate Administrators', person: 'Portfolio Manager' },
  { id: 'cust-019', name: 'Pretoria East Managing Agents', person: 'Agency Administrator' },
];

const NOTES = [
  'Arrived when they said they would and left the site clean.',
  'Quotes are clear and they stick to them.',
  'Handled an after-hours emergency without fuss.',
  'Good communication with trustees on a difficult job.',
  'Paperwork always in order — COIDA and insurance never lapse.',
  'Fixed it first time; residents noticed.',
];

const DOC_TYPES: ContractorDocument['type'][] = [
  'Company registration (CIPC)', 'COIDA letter of good standing', 'Public liability insurance', 'Tax compliance (SARS PIN)', 'B-BBEE certificate',
];

export function seedProfiles(): { profiles: ContractorProfile[]; endorsements: ContractorEndorsement[] } {
  const endorsements: ContractorEndorsement[] = [];
  const profiles = PARTIES.map((p) => {
    const r = seeded(p.id);
    const level = p.level ?? (r() < 0.7 ? 'verified' : 'listed');
    const verified = level !== 'listed';
    const count = p.endorsements ?? Math.floor(r() * 6);
    for (let i = 0; i < count; i++) {
      const from = p.endorsedBy
        ? ENDORSERS.find((e) => e.id === p.endorsedBy![i])!
        : p.endorsements
          ? ENDORSERS[i % ENDORSERS.length]
          : ENDORSERS[(i * 3 + Math.floor(r() * 3)) % ENDORSERS.length];
      if (endorsements.some((e) => e.partyId === p.id && e.fromCustomerId === from.id)) continue;
      endorsements.push({
        id: `end-${p.id}-${i}`, partyId: p.id, fromCustomerId: from.id, fromCustomerName: from.name, endorsedBy: from.person,
        basedOnCompletedJobs: 2 + Math.floor(r() * 9), note: NOTES[Math.floor(r() * NOTES.length)], at: day(p.endorsedBy ? -12 - i * 21 : -20 - Math.floor(r() * 400)),
      });
    }
    const established = p.established ?? 2004 + Math.floor(r() * 16);
    const slug = p.name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
    return {
      party: {
        id: p.id, tradingName: p.name, legalName: `${p.name} (Pty) Ltd`, registrationNo: `20${10 + Math.floor(r() * 14)}/${100000 + Math.floor(r() * 899999)}/07`,
        vatNo: `4${Math.floor(100000000 + r() * 899999999)}`, capabilities: p.categories.includes('Gardens') || p.categories.includes('Pest control') ? ['contractor', 'supplier'] : ['contractor'],
        established, onHumoSince: Math.max(2025, established), contact: { name: p.contact, phone: `08${Math.floor(1 + r() * 4)} ${Math.floor(100 + r() * 900)} ${Math.floor(1000 + r() * 9000)}`, email: `${p.contact.split(' ')[0].toLowerCase()}@${slug}.example` },
      },
      summary: `${p.categories.join(' and ')} for sectional title schemes and estates across ${p.areas.slice(0, 2).join(' and ')}.`,
      services: p.categories.map((c) => ({ category: c, description: SERVICE_TEXT[c], leadTimeDays: 2 + Math.floor(r() * 10) })),
      areas: p.areas.map((a) => ({ name: a, province: p.province })),
      documents: DOC_TYPES.map((type) => ({ type, onFile: verified || r() < 0.6, expires: type === 'Company registration (CIPC)' ? undefined : day(40 + Math.floor(r() * 300)), verifiedByHumo: verified })),
      insurance: [{ kind: 'Public liability' as const, insurer: ['Santam', 'Hollard', 'Old Mutual Insure', 'Bryte'][Math.floor(r() * 4)], coverAmount: [2_000_000, 5_000_000, 10_000_000][Math.floor(r() * 3)], expires: day(90 + Math.floor(r() * 250)), verifiedByHumo: verified }],
      verification: { level, businessVerified: verified, insuranceVerified: verified, complianceVerified: verified, reviewedAt: verified ? day(-30 - Math.floor(r() * 90)) : undefined },
      reputation: {
        rating: Math.round((4 + r() * 0.8) * 10) / 10, ratingsCount: 6 + Math.floor(r() * 40), completedJobs: 8 + Math.floor(r() * 60), completionRate: 90 + Math.floor(r() * 10),
        onTimeRate: 75 + Math.floor(r() * 22), quoteResponseRate: 70 + Math.floor(r() * 28), medianResponseHours: 10 + Math.floor(r() * 60), endorsements: 0,
        humoRelationships: 1 + Math.floor(r() * 8), yearsActive: new Date().getFullYear() - established, ...p.rep,
      },
      endorsements: [],
      availability: { nextAvailable: day(2 + Math.floor(r() * 20)), status: r() < 0.6 ? ('available' as const) : r() < 0.85 ? ('limited' as const) : ('fully-booked' as const) },
    } satisfies ContractorProfile;
  });
  return { profiles, endorsements };
}

const SERVICE_TEXT: Record<ServiceCategory, string> = {
  Plumbing: 'Geysers, leaks, drainage and water pressure.',
  Electrical: 'Fault finding, DB boards, lighting and compliance certificates.',
  'Roofing & waterproofing': 'Membranes, leaks, gutters and roof repairs.',
  Painting: 'Interior and exterior painting, walls and foyers.',
  Security: 'Electric fencing, CCTV and access control.',
  'Gate automation': 'Vehicle and pedestrian gates, motors and access integration.',
  Lifts: 'Lift maintenance, inspections and repairs.',
  Gardens: 'Garden maintenance, irrigation and tree felling.',
  Pools: 'Pool maintenance and repairs.',
  'Pest control': 'Scheduled and once-off pest control.',
  Building: 'Structural repairs, paving and general building.',
  'Fire equipment': 'Fire equipment servicing and compliance.',
};

// ---------------------------------------------------------------- Quote requests

export function seedQuoteRequests(): { requests: QuoteRequest[]; quotes: ContractorQuote[]; events: QuoteLifecycleEvent[]; workOrders: WorkOrder[] } {
  const gate: QuoteRequest = {
    id: 'QR-2041',
    customerId: 'acacia',
    customerName: 'Acacia Managing Agents',
    site: { name: 'Kingfisher Court', suburb: 'Bryanston', city: 'Sandton' },
    source: { product: 'humo-pm', ref: 'MR-1070' },
    title: 'Replace damaged entrance gate',
    description: 'A delivery truck reversed into the main vehicle gate. The leaf is bent and the motor bracket sheared; the gate is chained open and guarded at night.',
    category: 'Gate automation',
    requirements: ['Remove the old gate', 'Supply a replacement sliding gate (5.5 m)', 'Install a new motor', 'Test access control with the existing intercom and remotes'],
    photos: 3,
    deadline: day(23, 17),
    createdAt: day(-5, 10),
    createdBy: 'Johan van der Merwe',
    status: 'open',
    invitations: [
      { partyId: 'party-abc-gates', invitedAt: day(-5, 10), via: 'existing-relationship', status: 'quoted' },
      { partyId: 'party-xyz-security', invitedAt: day(-5, 10), via: 'existing-relationship', status: 'quoted' },
      { partyId: 'party-secureaccess', invitedAt: day(-5, 10), via: 'email-invite', status: 'quoted' },
      { partyId: 'party-gate-automation', invitedAt: day(-5, 10), via: 'existing-relationship', status: 'declined', declineReason: 'Fully booked until December' },
    ],
  };
  const quotes: ContractorQuote[] = [
    {
      id: 'CQ-5101', quoteRequestId: 'QR-2041', partyId: 'party-abc-gates', amount: 38_500, guaranteeMonths: 12, submittedAt: day(-3, 15), status: 'submitted',
      proposedWork: ['Remove and dispose of the damaged gate', 'Fabricate and fit a 5.5 m galvanised steel sliding gate', 'Supply and install Centurion D10 motor with anti-theft bracket', 'Reconnect intercom and re-code 64 remotes'],
      startBy: day(9), completeBy: day(12), validUntil: day(30),
    },
    {
      id: 'CQ-5102', quoteRequestId: 'QR-2041', partyId: 'party-xyz-security', amount: 42_000, guaranteeMonths: 24, submittedAt: day(-2, 11), status: 'submitted',
      proposedWork: ['Remove damaged gate and rail', 'Supply aluminium sliding gate (lighter, rust-free)', 'Install Centurion D10 Turbo motor and battery backup', 'Upgrade access control to app-based opening', 'Test with intercom and remotes'],
      exclusions: 'Civil work if the rail foundation is damaged.', startBy: day(14), completeBy: day(18), validUntil: day(21),
    },
    {
      id: 'CQ-5103', quoteRequestId: 'QR-2041', partyId: 'party-secureaccess', amount: 35_900, guaranteeMonths: 12, submittedAt: day(-1, 9), status: 'submitted',
      proposedWork: ['Remove damaged gate', 'Supply 5.5 m steel sliding gate, primed and painted', 'Install Centurion D5-Evo motor with anti-theft bracket', 'Test access control and re-code remotes'],
      startBy: day(7), completeBy: day(9), validUntil: day(30),
    },
  ];

  const others: QuoteRequest[] = [
    {
      id: 'QR-2038', customerId: 'tshikrand', customerName: 'Tshikrand', site: { name: 'Silver Oaks Estate', suburb: 'Faerie Glen', city: 'Pretoria' },
      title: 'Boom gate and guardhouse intercom upgrade', description: 'Replace the visitor boom gate and integrate the guardhouse intercom with resident phones.',
      category: 'Gate automation', requirements: ['Replace visitor boom', 'Integrate intercom with resident phones', 'Train guards'], photos: 4,
      deadline: day(5, 17), createdAt: day(-4), createdBy: 'Tshikrand portfolio manager', status: 'open',
      invitations: [{ partyId: 'party-secureaccess', invitedAt: day(-4), via: 'existing-relationship', status: 'invited' }, { partyId: 'party-abc-gates', invitedAt: day(-4), via: 'existing-relationship', status: 'quoted' }],
    },
    {
      id: 'QR-2044', customerId: 'umgeni', customerName: 'Umgeni BC Services', site: { name: 'Ridgeview Gardens', suburb: 'Hillcrest', city: 'Durban' },
      title: 'Pedestrian gate access control', description: 'Add tag access to two pedestrian gates; current keypads fail in the rain.',
      category: 'Security', requirements: ['Replace two keypads with tag readers', 'Supply 120 tags', 'Weatherproof housings'], photos: 2,
      deadline: day(9, 17), createdAt: day(-2), createdBy: 'Umgeni portfolio manager', status: 'open',
      invitations: [{ partyId: 'party-secureaccess', invitedAt: day(-2), via: 'existing-relationship', status: 'viewed' }],
    },
    {
      id: 'QR-2046', customerId: 'cust-oakridge', customerName: 'Oakridge Managing Agents', site: { name: 'Oakwood Estate', suburb: 'Midrand', city: 'Johannesburg' },
      title: 'Electric fence zone keeps alarming', description: 'Zone 3 alarms nightly; suspect vegetation and an energiser fault.',
      category: 'Security', requirements: ['Fault-find zone 3', 'Clear vegetation contact points', 'Replace energiser if needed', 'Issue an electric fence certificate'], photos: 1,
      deadline: day(2, 17), createdAt: day(-1), createdBy: 'Oakridge portfolio manager', status: 'open',
      invitations: [{ partyId: 'party-secureaccess', invitedAt: day(-1), via: 'email-invite', status: 'invited' }],
    },
  ];

  const ev = (at: string, type: QuoteLifecycleEvent['type'], extra: Partial<QuoteLifecycleEvent> = {}): QuoteLifecycleEvent => ({
    id: `qe-${Math.random().toString(36).slice(2, 9)}`, at, type, quoteRequestId: 'QR-2041', customerId: 'acacia', actor: 'Johan van der Merwe', ...extra,
  });
  const events: QuoteLifecycleEvent[] = [
    ev(day(-5, 10), 'quote-request-created'),
    ...gate.invitations.map((i) => ev(day(-5, 10), 'contractor-invited', { partyId: i.partyId })),
    ev(day(-4, 16), 'quote-declined', { partyId: 'party-gate-automation', actor: 'Gate Automation SA' }),
    ...quotes.map((q) => ev(q.submittedAt, 'quote-submitted', { partyId: q.partyId, quoteId: q.id, amount: q.amount, actor: 'Contractor' })),
  ];

  const sites = ['Silver Oaks Estate, Faerie Glen', 'Morningside Manor, Sandton', 'Waterkloof Ridge Estate, Pretoria', 'Lonehill Village, Sandton', 'Craighall Mews, Johannesburg'];
  const titles = ['Gate motor replacement', 'CCTV upgrade, 6 cameras', 'Electric fence repair, zone 2', 'Boom gate service', 'Intercom handsets, Block B'];
  const status: WorkOrder['status'][] = ['scheduled', 'in-progress', 'scheduled', 'awarded', 'in-progress'];
  const customers = [ENDORSERS[0], ENDORSERS[5], ENDORSERS[6], ENDORSERS[3], ENDORSERS[9]];
  const workOrders: WorkOrder[] = titles.map((t, i) => ({
    id: `WO-${7801 + i}`, partyId: 'party-secureaccess', customerId: customers[i].id, customerName: customers[i].name, title: t, site: sites[i],
    amount: [14_200, 32_800, 6_400, 3_900, 9_750][i], scheduledFor: day([1, 0, 3, 8, -1][i], [8, 9, 10, 8, 13][i]), status: status[i],
  }));

  return { requests: [gate, ...others], quotes, events, workOrders };
}
