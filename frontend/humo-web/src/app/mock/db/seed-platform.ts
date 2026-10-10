import { FeatureModule, MonthPoint, PackageId, Subscription, UpgradeRequest, UsageSnapshot } from '../../domain';
import { seeded } from './random';

/** One customer as stored by the platform (everything else is computed from this). */
export interface CustomerSeed {
  organisationId: string;
  name: string;
  city: string;
  province: string;
  customerSince: string;
  accountManagerId: string;
  accountManager: string;
  subscription: Subscription;
  snapshot: UsageSnapshot;
}

export const ACCOUNT_MANAGERS = [
  { id: 'p-dumisani', name: 'Dumisani Ngcobo' },
  { id: 'am-thabo', name: 'Thabo Mahlangu' },
  { id: 'am-carla', name: 'Carla de Wet' },
];

/** Board-level targets the generated book of business adds up to (mock). */
export const TARGETS = { customers: 184, mrr: 1_840_000, schemes: 3_842, units: 182_400, activeUsers: 8_214 };

const now = () => new Date();
const iso = (monthsAgo: number, day = 1) => {
  const d = now();
  return new Date(d.getFullYear(), d.getMonth() - monthsAgo, day, 9).toISOString();
};
const inMonths = (m: number, day = 1) => iso(-m, day);

const MODULES: FeatureModule[] = ['portfolio', 'finance', 'maintenance', 'communications', 'documents', 'governance', 'compliance', 'reporting'];

function usage(values: Partial<Record<FeatureModule, number>>): UsageSnapshot['moduleUsage'] {
  return Object.fromEntries(MODULES.map((m) => [m, { events30d: values[m] ?? 0, expected: 100 }]));
}

function weekly(target: number, drift: number, r = Math.random): number[] {
  return Array.from({ length: 11 }, (_, i) => Math.round(Math.max(20, Math.min(98, target - drift * (11 - i) / 11 + (r() - 0.5) * 4))));
}

// ---------------------------------------------------------------- Hand-written customers

const NAMED: CustomerSeed[] = [
  {
    organisationId: 'tshikrand', name: 'Tshikrand', city: 'Pretoria', province: 'Gauteng', customerSince: iso(16),
    accountManagerId: 'p-dumisani', accountManager: 'Dumisani Ngcobo',
    subscription: { version: 1, organisationId: 'tshikrand', packageId: 'professional', status: 'active', startedAt: iso(16), renewsAt: inMonths(8), addOns: [], overrides: [], mrr: 24_800, seats: 22 },
    snapshot: {
      organisationId: 'tshikrand', at: new Date().toISOString(), seats: 22, activeUsers30d: 16, loginsPerUserWeek: 3.6,
      moduleUsage: usage({ portfolio: 92, finance: 96, maintenance: 88, communications: 80, documents: 71, governance: 12, reporting: 64 }),
      workflowsStarted30d: 451, workflowsCompleted30d: 390, openTickets: 3, criticalTickets: 0, paymentStatus: 'current',
      schemes: 38, units: 2140, trustees: 8, meetingsPerYear: 14, reportExports30d: 18, maintenanceRequests30d: 64, receiptsAllocated30d: 1_870,
      portalUsers30d: 412, scoreHistory: [81, 82, 82, 84, 83, 85, 85, 86, 86, 87, 86],
    },
  },
  {
    organisationId: 'acacia', name: 'Acacia Managing Agents', city: 'Johannesburg', province: 'Gauteng', customerSince: iso(17),
    accountManagerId: 'p-dumisani', accountManager: 'Dumisani Ngcobo',
    subscription: {
      version: 1, organisationId: 'acacia', packageId: 'professional', status: 'active', startedAt: iso(17), renewsAt: inMonths(7), addOns: [{ addOnId: 'governance', since: iso(2) }, { addOnId: 'compliance', since: iso(1) }], mrr: 17_400, seats: 14,
      // An Enterprise capability on a Professional plan: a time-boxed pilot, granted by the account manager.
      overrides: [{ feature: 'document-templates-custom', enabled: true, reason: 'Custom statement pilot', by: 'Dumisani Ngcobo', at: iso(3), expiresAt: inMonths(2) }],
    },
    snapshot: {
      organisationId: 'acacia', at: new Date().toISOString(), seats: 14, activeUsers30d: 11, loginsPerUserWeek: 4.2,
      moduleUsage: usage({ portfolio: 88, finance: 91, maintenance: 84, communications: 62, documents: 48, governance: 21, reporting: 22 }),
      workflowsStarted30d: 286, workflowsCompleted30d: 251, openTickets: 1, criticalTickets: 0, paymentStatus: 'current',
      schemes: 24, units: 1284, trustees: 72, meetingsPerYear: 46, reportExports30d: 6, maintenanceRequests30d: 42, receiptsAllocated30d: 1_104,
      portalUsers30d: 236, scoreHistory: [76, 77, 79, 78, 80, 81, 80, 82, 83, 83, 84],
    },
  },
  {
    organisationId: 'umgeni', name: 'Umgeni BC Services', city: 'Durban', province: 'KwaZulu-Natal', customerSince: iso(11),
    accountManagerId: 'p-dumisani', accountManager: 'Dumisani Ngcobo',
    subscription: { version: 1,
      organisationId: 'umgeni', packageId: 'professional', status: 'active', startedAt: iso(11), renewsAt: inMonths(1, 15),
      addOns: [{ addOnId: 'governance', since: iso(4) }], overrides: [], mrr: 17_600, seats: 12,
    },
    snapshot: {
      organisationId: 'umgeni', at: new Date().toISOString(), seats: 12, activeUsers30d: 7, loginsPerUserWeek: 2.4,
      moduleUsage: usage({ portfolio: 74, finance: 68, maintenance: 51, communications: 40, documents: 22, governance: 18, reporting: 30 }),
      workflowsStarted30d: 198, workflowsCompleted30d: 131, openTickets: 5, criticalTickets: 1, paymentStatus: 'current',
      schemes: 17, units: 902, trustees: 41, meetingsPerYear: 30, reportExports30d: 9, maintenanceRequests30d: 31, receiptsAllocated30d: 640,
      portalUsers30d: 88, scoreHistory: [74, 72, 71, 70, 69, 66, 65, 64, 62, 61, 60],
    },
  },
  {
    organisationId: 'fynbos', name: 'Fynbos Property Admin', city: 'Cape Town', province: 'Western Cape', customerSince: iso(8),
    accountManagerId: 'am-carla', accountManager: 'Carla de Wet',
    subscription: { version: 1,
      organisationId: 'fynbos', packageId: 'essentials', status: 'past-due', startedAt: iso(8), renewsAt: inMonths(4), addOns: [],
      overrides: [{ feature: 'payment-allocation', enabled: true, reason: 'Trial while they evaluate Professional', by: 'Carla de Wet', at: iso(0, 1), expiresAt: inMonths(1, 1) }],
      mrr: 4_200, seats: 6,
    },
    snapshot: {
      organisationId: 'fynbos', at: new Date().toISOString(), seats: 6, activeUsers30d: 2, loginsPerUserWeek: 1.2,
      moduleUsage: usage({ portfolio: 44, finance: 31, maintenance: 12, communications: 18, documents: 9 }),
      workflowsStarted30d: 61, workflowsCompleted30d: 28, openTickets: 4, criticalTickets: 1, paymentStatus: 'overdue',
      schemes: 11, units: 486, trustees: 22, meetingsPerYear: 8, reportExports30d: 2, maintenanceRequests30d: 9, receiptsAllocated30d: 210,
      portalUsers30d: 14, scoreHistory: [61, 58, 57, 55, 52, 50, 49, 47, 46, 45, 44],
    },
  },
];

// ---------------------------------------------------------------- Generated book of business

const PLACES: [string, string][] = [
  ['Highveld', 'Gauteng'], ['Magalies', 'North West'], ['Vaal', 'Gauteng'], ['Lowveld', 'Mpumalanga'], ['Garden Route', 'Western Cape'],
  ['Drakensberg', 'KwaZulu-Natal'], ['Waterberg', 'Limpopo'], ['Overberg', 'Western Cape'], ['Winelands', 'Western Cape'], ['Sandton', 'Gauteng'],
  ['Midrand', 'Gauteng'], ['Centurion', 'Gauteng'], ['Umhlanga', 'KwaZulu-Natal'], ['Ballito', 'KwaZulu-Natal'], ['Durbanville', 'Western Cape'],
  ['Somerset', 'Western Cape'], ['Hermanus', 'Western Cape'], ['Knysna', 'Western Cape'], ['Polokwane', 'Limpopo'], ['Mbombela', 'Mpumalanga'],
  ['Bloemfontein', 'Free State'], ['Gqeberha', 'Eastern Cape'], ['Buffalo City', 'Eastern Cape'], ['Rustenburg', 'North West'], ['Kimberley', 'Northern Cape'],
  ['George', 'Western Cape'], ['Stellenbosch', 'Western Cape'], ['Paarl', 'Western Cape'], ['Pietermaritzburg', 'KwaZulu-Natal'], ['Fourways', 'Gauteng'],
  ['Bryanston', 'Gauteng'], ['Kempton Park', 'Gauteng'], ['Boksburg', 'Gauteng'], ['Hillcrest', 'KwaZulu-Natal'], ['Bedfordview', 'Gauteng'], ['Constantia', 'Western Cape'],
];
const SUFFIXES = ['Property Management', 'Managing Agents', 'Body Corporate Services', 'Estate Administrators', 'Sectional Title Services'];
const CITY: Record<string, string> = { Gauteng: 'Johannesburg', 'Western Cape': 'Cape Town', 'KwaZulu-Natal': 'Durban', Limpopo: 'Polokwane', Mpumalanga: 'Mbombela', 'North West': 'Rustenburg', 'Free State': 'Bloemfontein', 'Eastern Cape': 'Gqeberha', 'Northern Cape': 'Kimberley' };

/** Scales values so they add up to `target` exactly (remainder on the largest). */
function fitTotal(values: number[], target: number): number[] {
  const sum = values.reduce((n, v) => n + v, 0);
  const scaled = values.map((v) => Math.max(1, Math.round((v / sum) * target)));
  const diff = target - scaled.reduce((n, v) => n + v, 0);
  const i = scaled.indexOf(Math.max(...scaled));
  scaled[i] += diff;
  return scaled;
}

function generate(): CustomerSeed[] {
  const r = seeded('humo-platform');
  const out: CustomerSeed[] = [];
  const used = new Set<string>();
  for (let i = 0; out.length < TARGETS.customers - NAMED.length; i++) {
    const [place, province] = PLACES[i % PLACES.length];
    const suffix = SUFFIXES[Math.floor(i / PLACES.length) % SUFFIXES.length];
    const name = `${place} ${suffix}`;
    if (used.has(name)) continue;
    used.add(name);
    const roll = r();
    const packageId: PackageId = roll < 0.42 ? 'essentials' : roll < 0.86 ? 'professional' : 'enterprise';
    const units = Math.round(packageId === 'essentials' ? 150 + r() * 650 : packageId === 'professional' ? 500 + r() * 1300 : 1500 + r() * 2600);
    const schemes = Math.max(3, Math.round(units / (38 + r() * 18)));
    const seats = Math.max(3, Math.round(units / 48 + r() * 4));
    // Engagement: most customers are healthy, some drifting, a few in trouble.
    const e = roll < 0.03 ? 0.35 : r() < 0.08 ? 0.38 + r() * 0.15 : r() < 0.24 ? 0.6 + r() * 0.12 : 0.8 + r() * 0.2;
    const mod = (base: number) => Math.round(Math.min(100, base * e * (0.85 + r() * 0.3)));
    const months = 1 + Math.floor(r() * 40);
    const addOns: Subscription['addOns'] = packageId === 'professional' && r() < 0.18 ? [{ addOnId: 'governance', since: iso(Math.floor(r() * 10)) }] : [];
    if (packageId !== 'enterprise' && r() < 0.1) addOns.push({ addOnId: 'whatsapp', since: iso(Math.floor(r() * 6)) });
    const am = ACCOUNT_MANAGERS[i % 3];
    const organisationId = `cust-${String(i + 1).padStart(3, '0')}`;
    const baseMrr = packageId === 'essentials' ? 2600 + r() * 3000 : packageId === 'professional' ? 7000 + r() * 8000 : 21000 + r() * 22000;
    out.push({
      organisationId, name, city: CITY[province] ?? place, province, customerSince: iso(months),
      accountManagerId: am.id, accountManager: am.name,
      subscription: { version: 1,
        organisationId, packageId, status: e < 0.42 && r() < 0.5 ? 'past-due' : months < 1 ? 'trial' : 'active', startedAt: iso(months),
        renewsAt: inMonths(1 + Math.floor(r() * 11), 1 + Math.floor(r() * 27)), addOns, overrides: [], mrr: Math.round(baseMrr), seats,
      },
      snapshot: {
        organisationId, at: new Date().toISOString(), seats, activeUsers30d: Math.max(1, Math.round(seats * Math.min(1, e * (0.75 + r() * 0.25)))),
        loginsPerUserWeek: Math.round(e * (2.5 + r() * 3) * 10) / 10,
        moduleUsage: usage({
          portfolio: mod(95), finance: mod(packageId === 'essentials' ? 55 : 92), maintenance: mod(85), communications: mod(70), documents: mod(60),
          // For modules a customer doesn't have, these are demand signals — most show little, a few a lot.
          governance: packageId === 'enterprise' || addOns.length ? mod(60) : Math.round(r() < 0.3 ? 8 + r() * 14 : r() * 7),
          compliance: mod(packageId === 'enterprise' ? 55 : 0),
          reporting: packageId === 'enterprise' ? mod(60) : Math.round(r() < 0.35 ? 15 + r() * 30 : r() * 12),
        }),
        workflowsStarted30d: Math.round(units / 5),
        workflowsCompleted30d: Math.round((units / 5) * Math.min(1, e * (0.9 + r() * 0.1))),
        openTickets: Math.floor((1 - e) * 8 * r()), criticalTickets: e < 0.45 && r() < 0.5 ? 1 : 0,
        paymentStatus: e < 0.42 && r() < 0.5 ? 'overdue' : 'current',
        schemes, units, trustees: Math.round(schemes * (2 + r() * 2)), meetingsPerYear: Math.round(schemes * (0.8 + r())),
        reportExports30d: Math.round(r() < 0.3 ? 10 + r() * 28 : r() * 9), maintenanceRequests30d: Math.round(units / 30), receiptsAllocated30d: Math.round(units * 0.85),
        portalUsers30d: Math.round(units * (0.02 + r() * 0.04)),
        scoreHistory: weekly(Math.round(e * 90), (r() - 0.4) * 12, r),
      },
    });
  }

  // Make the whole book add up to the board-level numbers.
  const named = (k: (c: CustomerSeed) => number) => NAMED.reduce((n, c) => n + k(c), 0);
  const fit = (get: (c: CustomerSeed) => number, set: (c: CustomerSeed, v: number) => void, target: number) =>
    fitTotal(out.map(get), target - named(get)).forEach((v, i) => set(out[i], v));
  fit((c) => c.subscription.mrr, (c, v) => (c.subscription.mrr = v), TARGETS.mrr);
  fit((c) => c.snapshot.units, (c, v) => (c.snapshot.units = v), TARGETS.units);
  fit((c) => c.snapshot.schemes, (c, v) => (c.snapshot.schemes = v), TARGETS.schemes);
  fit(
    (c) => c.snapshot.activeUsers30d + (c.snapshot.portalUsers30d ?? 0),
    (c, v) => (c.snapshot.portalUsers30d = Math.max(0, v - c.snapshot.activeUsers30d)),
    TARGETS.activeUsers,
  );
  return out;
}

export function seedCustomers(): CustomerSeed[] {
  return [...NAMED.map((c) => structuredClone(c)), ...generate()];
}

/** Twelve months of company history ending at today's figures. */
export function seedHistory(currentMrr: number, currentCustomers: number, activeUsers: number): MonthPoint[] {
  const r = seeded('humo-history');
  const months = 12;
  const newPerMonth = [2, 3, 2, 3, 3, 2, 4, 3, 2, 3, 4, 3];
  const churnPerMonth = [0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1];
  const points: MonthPoint[] = [];
  let customers = currentCustomers;
  let mrr = currentMrr;
  let users = activeUsers;
  for (let i = 0; i < months; i++) {
    const d = now();
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const month = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    const k = months - 1 - i;
    const expansion = Math.round(9_000 + r() * 9_000);
    const churnedMrr = churnPerMonth[k] ? Math.round(4_000 + r() * 6_000) : 0;
    points.unshift({ month, mrr, customers, newCustomers: newPerMonth[k], churned: churnPerMonth[k], expansionMrr: expansion, churnedMrr, activeUsers: users });
    const newMrr = newPerMonth[k] * (8_500 + r() * 3_000);
    mrr = Math.round(mrr - newMrr - expansion + churnedMrr);
    customers = customers - newPerMonth[k] + churnPerMonth[k];
    users = Math.round(users / (1.025 + r() * 0.02));
  }
  return points;
}

export function seedRequests(): UpgradeRequest[] {
  return [
    {
      id: 'ur-1', organisationId: 'umgeni', addOn: 'advanced-reporting', requestedBy: 'Sbu Mkhize (Agency Administrator)', at: iso(0, 2),
      note: 'Trustees want monthly variance reports without us building them in Excel.', source: 'plan-page', status: 'new',
    },
    { id: 'ur-2', organisationId: 'cust-014', package: 'professional', requestedBy: 'Agency Administrator', at: iso(1, 21), source: 'nudge', status: 'in-progress' },
  ];
}

