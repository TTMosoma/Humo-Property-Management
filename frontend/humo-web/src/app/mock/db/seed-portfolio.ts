import { Account, AccountStatus, Ageing, Person, Relationship, Scheme, SchemeHealth, Unit } from '../../domain';
import { SCHEME_HEALTH } from '../fixtures/scheme-health';
import { SCHEMES } from '../fixtures/schemes';
import { COMPANY_NAMES, FIRST_NAMES, LAST_NAMES, MOBILE_PREFIXES } from './names';
import { pad3, pick, round2, seeded } from './random';

export interface PortfolioSeed {
  units: Unit[];
  persons: Person[];
  relationships: Relationship[];
  accounts: Account[];
}

/** Monthly charges beyond the levy, per scheme (used by the ledger generator too). */
export interface SchemeCharges {
  specialLevy?: { label: string; ratio: number; startMonthOffset: number; instalments: number };
  waterRecovery?: boolean;
}

export const SCHEME_CHARGES: Record<string, SchemeCharges> = {
  'kingfisher-court': {
    specialLevy: { label: 'Special levy — roof waterproofing', ratio: 0.2644, startMonthOffset: -2, instalments: 6 },
    waterRecovery: true,
  },
  'waterkloof-ridge': {
    specialLevy: { label: 'Special levy — perimeter security upgrade', ratio: 0.18, startMonthOffset: -2, instalments: 6 },
  },
  'the-willows': { waterRecovery: true },
  'rosebank-terraces': { waterRecovery: true },
  'midrand-crossing': { waterRecovery: true },
};

/** The people and balances in the demo stories (see README / docs). Keyed by account number. */
interface DemoPerson {
  id: string;
  first: string;
  last: string;
  kind?: Person['kind'];
  personaId?: string;
  email?: string;
  phone?: string;
}

const DEMO_OWNERS: Record<string, DemoPerson> = {
  'KC-042': { id: 'per-anele', first: 'Anele', last: 'Mthembu', personaId: 'p-anele', email: 'anele.m@mail.example', phone: '082 418 2290' },
  'DE-007': { id: 'per-anele', first: 'Anele', last: 'Mthembu' },
  'KC-012': { id: 'per-sipho', first: 'Sipho', last: 'Khumalo', personaId: 'p-sipho', email: 'sipho.khumalo@mail.example', phone: '083 551 0274' },
  // D2/D6: staff who sit on a board are owners with a seat on it, like any trustee.
  'KC-027': { id: 'per-sarah', first: 'Sarah', last: 'Jacobs', personaId: 'p-sarah', email: 'sarah.jacobs@acacia-ma.example', phone: '082 660 1934' },
  'TW-014': { id: 'per-mpho', first: 'Mpho', last: 'Sebe', personaId: 'p-mpho', email: 'mpho.sebe@mail.example', phone: '071 284 5530' },
  'KC-031': { id: 'per-lindiwe', first: 'Lindiwe', last: 'Ndlovu', phone: '072 903 1148' },
  'KC-005': { id: 'per-fatima', first: 'Fatima', last: 'Essop' },
  'KC-050': { id: 'per-daniel', first: 'Daniel', last: 'Naidoo' },
  'KC-017': { id: 'per-pph', first: 'Werner', last: 'Pretorius', kind: 'company' },
  'KC-018': { id: 'per-pph', first: 'Werner', last: 'Pretorius', kind: 'company' },
  'KC-023': { id: 'per-kc23', first: 'Nadia', last: 'Abrahams' },
  'JH-008': { id: 'per-thabo', first: 'Thabo', last: 'Nkosi' },
  'JH-015': { id: 'per-ayesha', first: 'Ayesha', last: 'Patel' },
  'MC-044': { id: 'per-marius', first: 'Marius', last: 'Pretorius' },
  'MM-003': { id: 'per-grace', first: 'Grace', last: 'Mahlangu' },
  'RT-008': { id: 'per-pieter', first: 'Pieter', last: 'Joubert' },
  'WRE-061': { id: 'per-hendrik', first: 'Hendrik', last: 'Steyn' },
};

const DEMO_TENANTS: Record<string, DemoPerson> = {
  'KC-017': { id: 'per-ruan', first: 'Ruan', last: 'Botha', personaId: 'p-ruan', email: 'ruan.botha@mail.example', phone: '079 220 6631' },
  'MC-014': { id: 'per-kagiso', first: 'Kagiso', last: 'Mokoena' },
};

const DEMO_BALANCES: Record<string, number> = {
  'KC-042': 4812.5,
  'KC-031': 14380.5,
  'KC-012': 0,
  'KC-017': 0,
  'KC-018': 0,
  'DE-007': 0,
  'JH-008': 6210,
  'MC-044': 23900.75,
  'JH-015': 0,
};

const DEMO_LEVIES: Record<string, number> = { 'KC-042': 3480, 'KC-031': 3150 };
const DEMO_STATUS: Record<string, AccountStatus> = { 'JH-008': 'arrangement' };
/** Owners in the demo story pay by EFT (so a wrong reference can go unmatched). */
const DEMO_EFT = new Set(['KC-042', 'KC-031']);
const DEMO_TRUSTEES: Record<string, { accountNo: string; portfolio: string }[]> = {
  'kingfisher-court': [
    { accountNo: 'KC-012', portfolio: 'Chairperson' },
    { accountNo: 'KC-005', portfolio: 'Treasurer' },
    { accountNo: 'KC-050', portfolio: 'Trustee' },
    { accountNo: 'KC-027', portfolio: 'Trustee' },
  ],
};

/** Seats added to a generated board, for personas who sign in as trustees (D2). */
const EXTRA_TRUSTEES: Record<string, { accountNo: string; portfolio: string }[]> = {
  'the-willows': [{ accountNo: 'TW-014', portfolio: 'Trustee' }],
};

const OCCUPANCY_OVERRIDE: Record<string, Unit['occupancy']> = {
  'KC-042': 'owner-occupied',
  'KC-012': 'owner-occupied',
  'KC-017': 'tenanted',
  'KC-018': 'tenanted',
  'MC-014': 'tenanted',
  'KC-031': 'owner-occupied',
};

export function monthlyCharges(unit: Unit): number {
  const cfg = SCHEME_CHARGES[unit.schemeId];
  const special = cfg?.specialLevy ? specialLevyAmount(unit, cfg) : 0;
  return unit.monthlyLevy + special + (cfg?.waterRecovery ? 420 : 0);
}

export function specialLevyAmount(unit: Unit, cfg: SchemeCharges): number {
  return cfg.specialLevy ? Math.round((unit.monthlyLevy * cfg.specialLevy.ratio) / 10) * 10 : 0;
}

/**
 * Ages a balance oldest-last: the latest month's charges are current, each
 * earlier month's (approximated by the monthly charge) one bucket older.
 * `latest` is the most recent month actually billed, when it differs from the
 * usual monthly charge (an estimated water bill, interest).
 */
export function ageingFor(balance: number, monthly: number, latest = monthly): Ageing {
  const a: Ageing = { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 };
  if (balance <= 0) return a;
  let rest = balance;
  for (const k of ['current', 'd30', 'd60', 'd90'] as const) {
    a[k] = round2(Math.min(rest, k === 'current' ? latest : monthly));
    rest = round2(rest - a[k]);
  }
  a.d120 = rest;
  return a;
}

export function statusFor(balance: number, ageing: Ageing, fixed?: AccountStatus): AccountStatus {
  if (fixed) return fixed;
  if (balance < 0) return 'in-credit';
  if (ageing.d30 + ageing.d60 + ageing.d90 + ageing.d120 > 0) return 'arrears';
  return 'up-to-date';
}

export function seedPortfolio(): PortfolioSeed {
  const units: Unit[] = [];
  const persons = new Map<string, Person>();
  const relationships: Relationship[] = [];
  const accounts: Account[] = [];
  let relSeq = 0;

  const makePerson = (r: () => number, demo?: DemoPerson, company = false): Person => {
    if (demo && persons.has(demo.id)) return persons.get(demo.id)!;
    const first = demo?.first ?? pick(r, FIRST_NAMES);
    const last = demo?.last ?? pick(r, LAST_NAMES);
    const isCompany = demo?.kind === 'company' || company;
    const companyName = demo?.id === 'per-pph' ? COMPANY_NAMES[0] : pick(r, COMPANY_NAMES);
    const id = demo?.id ?? `per-${persons.size + 1}`;
    const emailName = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
    const person: Person = {
      version: 1,
      id,
      firstName: first,
      lastName: last,
      kind: isCompany ? 'company' : 'individual',
      displayName: isCompany ? companyName : `${first} ${last}`,
      initials: isCompany ? companyName.slice(0, 2).toUpperCase() : `${first[0]}${last.replace(/^(van der |du |van )/i, '')[0]}`.toUpperCase(),
      email: demo?.email ?? (isCompany ? `accounts@${companyName.split(' ')[0].toLowerCase()}.example` : `${emailName}@mail.example`),
      phone: demo?.phone ?? `${pick(r, MOBILE_PREFIXES)} ${Math.floor(100 + r() * 900)} ${Math.floor(1000 + r() * 9000)}`,
      preferredChannel: r() > 0.7 ? 'whatsapp' : r() > 0.2 ? 'email' : 'sms',
      personaId: demo?.personaId,
    };
    persons.set(id, person);
    return person;
  };

  for (const scheme of SCHEMES) {
    const health = SCHEME_HEALTH.find((h) => h.schemeId === scheme.id)!;
    const r = seeded('units-' + scheme.id);
    const schemeUnits = buildUnits(scheme, health, r);
    units.push(...schemeUnits);

    // Owners & tenants
    let previousOwner: Person | null = null;
    const ownersInScheme: { person: Person; unit: Unit }[] = [];
    for (const unit of schemeUnits) {
      const demoOwner = DEMO_OWNERS[unit.accountNo];
      // Investors sometimes own neighbouring units — but never reuse the hand-written demo people.
      const reuse: boolean = !demoOwner && previousOwner !== null && /^per-\d+$/.test(previousOwner.id) && r() < 0.05;
      const owner: Person = reuse && previousOwner ? previousOwner : makePerson(r, demoOwner, !demoOwner && r() < 0.03);
      previousOwner = owner;
      ownersInScheme.push({ person: owner, unit });
      relationships.push({
        id: `rel-${++relSeq}`,
        personId: owner.id,
        type: 'owner',
        schemeId: scheme.id,
        unitId: unit.id,
        since: new Date(2012 + Math.floor(r() * 13), Math.floor(r() * 12), 1 + Math.floor(r() * 27)).toISOString(),
      });
      if (unit.occupancy === 'tenanted') {
        const tenant = makePerson(r, DEMO_TENANTS[unit.accountNo]);
        const start = new Date(2023 + Math.floor(r() * 3), Math.floor(r() * 12), 1);
        relationships.push({
          id: `rel-${++relSeq}`,
          personId: tenant.id,
          type: 'tenant',
          schemeId: scheme.id,
          unitId: unit.id,
          since: start.toISOString(),
          until: new Date(start.getFullYear() + 1, start.getMonth(), 0).toISOString(),
        });
      }
    }

    // Trustees
    const demoTrustees = DEMO_TRUSTEES[scheme.id];
    const trusteeCount = scheme.unitCount > 60 ? 5 : 3;
    const portfolios = ['Chairperson', 'Treasurer', 'Trustee', 'Trustee', 'Trustee'];
    const chosen = demoTrustees
      ? demoTrustees.map((t) => ({ owner: ownersInScheme.find((o) => o.unit.accountNo === t.accountNo)!, portfolio: t.portfolio }))
      : Array.from({ length: trusteeCount }, (_, i) => ({
          owner: ownersInScheme[Math.floor((i + 1) * (ownersInScheme.length / (trusteeCount + 1)))],
          portfolio: portfolios[i],
        }));
    for (const t of EXTRA_TRUSTEES[scheme.id] ?? []) {
      const owner = ownersInScheme.find((o) => o.unit.accountNo === t.accountNo);
      if (owner && !chosen.some((c) => c.owner.person.id === owner.person.id)) chosen.push({ owner, portfolio: t.portfolio });
    }
    for (const t of chosen) {
      if (t.owner.person.kind !== 'individual') continue;
      relationships.push({
        id: `rel-${++relSeq}`,
        personId: t.owner.person.id,
        type: 'trustee',
        schemeId: scheme.id,
        portfolio: t.portfolio,
        since: new Date(2021 + Math.floor(r() * 4), 10, 20).toISOString(),
        appointment: { how: 'before-humo' },
      });
    }

    accounts.push(...buildAccounts(scheme, health, schemeUnits, ownersInScheme, r));
  }

  return { units, persons: [...persons.values()], relationships, accounts };
}

function buildUnits(scheme: Scheme, health: SchemeHealth, r: () => number): Unit[] {
  const isHoa = scheme.type === 'Home Owners Association';
  const isShare = scheme.type === 'Share Block';
  const sizes = Array.from({ length: scheme.unitCount }, () =>
    isHoa ? 140 + Math.round(r() * 180) : isShare ? 50 + Math.round(r() * 60) : 48 + Math.round(r() * 92),
  );
  const total = sizes.reduce((a, b) => a + b, 0);

  return sizes.map((size, i) => {
    const n = i + 1;
    const accountNo = `${scheme.code}-${pad3(n)}`;
    const pq = (size / total) * 100;
    const levy = DEMO_LEVIES[accountNo] ?? Math.round(health.monthlyLevyRoll * (pq / 100));
    const roll = r();
    const occupancy = OCCUPANCY_OVERRIDE[accountNo] ?? (roll < 0.28 ? 'tenanted' : roll < 0.31 ? 'vacant' : 'owner-occupied');
    const perBlock = 16;
    const description = isHoa
      ? pick(r, ['3-bed house', '4-bed house', '3-bed house', '2-bed cluster home'])
      : isShare
        ? pick(r, ['1-bed flat', '2-bed flat', 'Bachelor flat'])
        : size > 120
          ? '3-bed apartment'
          : size > 85
            ? '2-bed apartment'
            : size > 62
              ? pick(r, ['1-bed apartment', '2-bed apartment'])
              : pick(r, ['Studio apartment', '1-bed apartment']);
    return {
      id: `unit-${accountNo.toLowerCase()}`,
      schemeId: scheme.id,
      number: String(n),
      accountNo,
      block: isHoa ? undefined : String.fromCharCode(65 + Math.floor(i / perBlock)),
      floor: isHoa ? undefined : Math.floor((i % perBlock) / 4),
      description,
      sizeM2: size,
      participationQuota: Math.round(pq * 10000) / 10000,
      monthlyLevy: levy,
      occupancy,
      parkingBays: isHoa ? [] : [`P${pad3(n)}`],
      version: 1,
    } satisfies Unit;
  });
}

function buildAccounts(
  scheme: Scheme,
  health: SchemeHealth,
  units: Unit[],
  owners: { person: Person; unit: Unit }[],
  r: () => number,
): Account[] {
  // Spread the scheme's arrears across a realistic number of accounts.
  const fixedTotal = units.reduce((sum, u) => sum + (DEMO_BALANCES[u.accountNo] ?? 0), 0);
  const candidates = units.filter((u) => DEMO_BALANCES[u.accountNo] === undefined);
  const arrearsCount = Math.max(2, Math.min(candidates.length, Math.round(units.length * 0.11) + health.accounts90Plus));
  const inArrears = new Set<string>();
  while (inArrears.size < arrearsCount) inArrears.add(candidates[Math.floor(r() * candidates.length)].id);
  const arrearsUnits = candidates.filter((u) => inArrears.has(u.id));
  const weights = arrearsUnits.map((_, i) => (i < health.accounts90Plus ? 4 + r() * 3 : 0.6 + r() * 1.4));
  const toSpread = Math.max(0, health.arrears - fixedTotal);

  // Spread by weight, but no account owes more than ~8 months; the excess moves to the others.
  const caps = arrearsUnits.map((u) => monthlyCharges(u) * 8);
  const spread = arrearsUnits.map(() => 0);
  let remaining = toSpread;
  for (let pass = 0; pass < 6 && remaining > 1; pass++) {
    const open = arrearsUnits.map((_, i) => i).filter((i) => spread[i] < caps[i]);
    const w = open.reduce((s, i) => s + weights[i], 0);
    if (!w) break;
    let used = 0;
    for (const i of open) {
      const add = Math.min(caps[i] - spread[i], (remaining * weights[i]) / w);
      spread[i] += add;
      used += add;
    }
    remaining -= used;
  }

  return units.map((unit) => {
    const holder = owners.find((o) => o.unit.id === unit.id)!.person;
    const idx = arrearsUnits.findIndex((u) => u.id === unit.id);
    let balance: number;
    if (DEMO_BALANCES[unit.accountNo] !== undefined) balance = DEMO_BALANCES[unit.accountNo];
    else if (idx >= 0) balance = round2(Math.max(unit.monthlyLevy * 1.2, spread[idx]));
    else balance = r() < 0.12 ? -round2(unit.monthlyLevy * (r() < 0.5 ? 1 : 0.5)) : 0;

    const ageing = ageingFor(balance, monthlyCharges(unit));
    return {
      id: `acc-${unit.accountNo.toLowerCase()}`,
      accountNo: unit.accountNo,
      unitId: unit.id,
      schemeId: scheme.id,
      holderPersonId: holder.id,
      balance,
      ageing,
      status: statusFor(balance, ageing, DEMO_STATUS[unit.accountNo]),
      debitOrder: DEMO_EFT.has(unit.accountNo) ? false : r() < 0.35,
      statementBy: r() < 0.8 ? 'email' : r() < 0.5 ? 'portal' : 'post',
    } satisfies Account;
  });
}
