import { Identity, IdentityStatus, RoleAssignment, ScopeType, isHumoRole } from '../../domain';
import { SCHEMES } from './schemes';

/** Seed shape: scope fields written flat for readability; `toIdentity` builds the real model. */
interface SeedAssignment extends Omit<RoleAssignment, 'scope' | 'status' | 'version'> {
  organisationId: string | null;
  schemeIds: string[];
  /** Owners and tenants: "Unit 42" in the scheme above. */
  unit?: string;
  status?: RoleAssignment['status'];
}

interface SeedIdentity extends Omit<Identity, 'assignments' | 'memberships' | 'status' | 'version'> {
  status?: IdentityStatus;
  assignments: SeedAssignment[];
}

const KC = 'kingfisher-court';
const JOHAN_SCHEMES = [
  KC,
  'the-willows',
  'rosebank-terraces',
  'midrand-crossing',
  'northcliff-view',
  'craighall-mews',
  'lonehill-village',
  'morningside-manor',
];

/**
 * Humo identities: one per human. Each holds one or more role assignments.
 * `demo: true` identities appear in the prototype toolbar's "Sign in as" list;
 * the rest exist so Users & access and impersonation have a realistic directory.
 */
const SEED: SeedIdentity[] = [
  // ---------------- Humo (internal) ----------------
  {
    id: 'p-terry',
    name: 'Terry Mosoma',
    initials: 'TM',
    email: 'terry@humo.example',
    kind: 'humo',
    demo: true,
    assignments: [
      {
        id: 'm-terry',
        role: 'system-admin',
        organisationId: null,
        schemeIds: [],
        label: 'Platform operations · impersonation authorised',
        grants: ['System.Impersonate'],
        grantedBy: 'Humo founders',
        grantedAt: '2026-01-12T09:00:00+02:00',
      },
    ],
  },
  {
    id: 'p-lerato',
    name: 'Lerato Dube',
    initials: 'LD',
    email: 'lerato.dube@humo.example',
    kind: 'humo',
    demo: true,
    assignments: [
      { id: 'm-lerato', role: 'humo-support', organisationId: null, schemeIds: [], label: 'Customer support', grantedBy: 'Terry Mosoma', grantedAt: '2026-03-02T09:00:00+02:00' },
    ],
  },

  // ---------------- Acacia Managing Agents ----------------
  {
    // One identity, four roles — the reference case for role switching.
    id: 'p-sarah',
    name: 'Sarah Jacobs',
    initials: 'SJ',
    email: 'sarah.jacobs@acacia-ma.example',
    kind: 'customer',
    title: 'Operations Director',
    staffId: 'staff-sarah',
    demo: true,
    assignments: [
      {
        id: 'm-sarah-pm',
        role: 'portfolio-manager',
        organisationId: 'acacia',
        schemeIds: ['protea-gardens', 'parkhurst-lofts', 'greenstone-commons'],
        label: 'Protea Gardens, Parkhurst Lofts, Greenstone Commons',
        grantedBy: 'Thandeka Mokoena',
        grantedAt: '2025-08-01T09:00:00+02:00',
      },
      { id: 'm-sarah-finance', role: 'finance', organisationId: 'acacia', schemeIds: [], label: 'All schemes', grantedBy: 'Thandeka Mokoena', grantedAt: '2025-08-01T09:00:00+02:00' },
      { id: 'm-sarah-admin', role: 'agency-admin', organisationId: 'acacia', schemeIds: [], label: 'Acacia Managing Agents', grantedBy: 'Thandeka Mokoena', grantedAt: '2026-02-14T09:00:00+02:00' },
      { id: 'm-sarah-trustee', role: 'trustee', organisationId: 'acacia', schemeIds: [KC], label: 'Kingfisher Court', grantedBy: 'Thandeka Mokoena', grantedAt: '2026-04-20T09:00:00+02:00' },
    ],
  },
  {
    id: 'p-thandeka',
    name: 'Thandeka Mokoena',
    initials: 'TM',
    email: 'thandeka@acacia-ma.example',
    kind: 'customer',
    title: 'Director',
    staffId: 'staff-thandeka',
    demo: true,
    assignments: [
      { id: 'm-thandeka', role: 'agency-admin', organisationId: 'acacia', schemeIds: [], label: 'Director · Acacia Managing Agents', grantedBy: 'Humo onboarding', grantedAt: '2025-06-01T09:00:00+02:00' },
    ],
  },
  {
    id: 'p-johan',
    name: 'Johan van der Merwe',
    initials: 'JM',
    email: 'johan@acacia-ma.example',
    kind: 'customer',
    title: 'Portfolio Manager',
    staffId: 'staff-johan',
    demo: true,
    assignments: [
      { id: 'm-johan', role: 'portfolio-manager', organisationId: 'acacia', schemeIds: JOHAN_SCHEMES, label: '8 schemes', grantedBy: 'Thandeka Mokoena', grantedAt: '2025-06-03T09:00:00+02:00' },
    ],
  },
  {
    id: 'p-priya',
    name: 'Priya Naidoo',
    initials: 'PN',
    email: 'priya@acacia-ma.example',
    kind: 'customer',
    title: 'Senior Accountant',
    staffId: 'staff-priya',
    demo: true,
    assignments: [
      { id: 'm-priya', role: 'finance', organisationId: 'acacia', schemeIds: [], label: 'Senior Accountant · All schemes', grantedBy: 'Thandeka Mokoena', grantedAt: '2025-06-03T09:00:00+02:00' },
    ],
  },
  {
    id: 'p-bongani',
    name: 'Bongani Ndlovu',
    initials: 'BN',
    email: 'bongani@acacia-ma.example',
    kind: 'customer',
    title: 'Maintenance Coordinator',
    staffId: 'staff-bongani',
    demo: true,
    assignments: [
      { id: 'm-bongani', role: 'operations', organisationId: 'acacia', schemeIds: JOHAN_SCHEMES, label: 'Maintenance Coordinator · 8 schemes', grantedBy: 'Thandeka Mokoena', grantedAt: '2026-05-11T09:00:00+02:00' },
      // History: a temporary cover assignment that has ended (assignments end; they are never deleted).
      { id: 'm-bongani-cover', role: 'portfolio-manager', organisationId: 'acacia', schemeIds: ['craighall-mews'], label: 'Covering Craighall Mews', grantedBy: 'Thandeka Mokoena', grantedAt: '2026-03-02T09:00:00+02:00', status: 'ended', endedBy: 'Thandeka Mokoena', endedAt: '2026-04-30T17:00:00+02:00' },
    ],
  },
  {
    // Multi-role: chairperson of the trustees AND an owner in the same scheme.
    id: 'p-sipho',
    name: 'Sipho Khumalo',
    initials: 'SK',
    email: 'sipho.khumalo@mail.example',
    kind: 'customer',
    personId: 'per-sipho',
    demo: true,
    assignments: [
      { id: 'm-sipho-trustee', role: 'trustee', organisationId: 'acacia', schemeIds: [KC], label: 'Chairperson · Kingfisher Court', grantedBy: 'Johan van der Merwe', grantedAt: '2025-11-20T18:00:00+02:00' },
      { id: 'm-sipho-owner', role: 'owner', organisationId: 'acacia', schemeIds: [KC], unit: 'Unit 12', label: 'Unit 12, Kingfisher Court', grantedBy: 'Johan van der Merwe', grantedAt: '2025-06-10T09:00:00+02:00' },
    ],
  },
  {
    // Multi-unit owner across two schemes.
    id: 'p-anele',
    name: 'Anele Mthembu',
    initials: 'AM',
    email: 'anele.m@mail.example',
    kind: 'customer',
    personId: 'per-anele',
    demo: true,
    assignments: [
      { id: 'm-anele-kc', role: 'owner', organisationId: 'acacia', schemeIds: [KC], unit: 'Unit 42', label: 'Unit 42, Kingfisher Court', grantedBy: 'Johan van der Merwe', grantedAt: '2025-06-10T09:00:00+02:00' },
      { id: 'm-anele-de', role: 'owner', organisationId: 'acacia', schemeIds: ['stellenbosch-oaks'], unit: 'Unit 7', label: 'Unit 7, Die Eike', grantedBy: 'Naledi Sithole', grantedAt: '2025-09-01T09:00:00+02:00' },
    ],
  },
  {
    id: 'p-ruan',
    name: 'Ruan Botha',
    initials: 'RB',
    email: 'ruan.botha@mail.example',
    kind: 'customer',
    personId: 'per-ruan',
    demo: true,
    assignments: [
      { id: 'm-ruan', role: 'tenant', organisationId: 'acacia', schemeIds: [KC], unit: 'Unit 17', label: 'Unit 17, Kingfisher Court', grantedBy: 'Johan van der Merwe', grantedAt: '2026-02-01T09:00:00+02:00' },
    ],
  },

  // ---------------- Directory only (not in the prototype's sign-in list) ----------------
  {
    id: 'p-naledi',
    name: 'Naledi Sithole',
    initials: 'NS',
    email: 'naledi@acacia-ma.example',
    kind: 'customer',
    title: 'Portfolio Manager',
    staffId: 'staff-naledi',
    assignments: [
      {
        id: 'm-naledi',
        role: 'portfolio-manager',
        organisationId: 'acacia',
        schemeIds: ['jacaranda-heights', 'waterkloof-ridge', 'silverlakes-manor', 'centurion-palms', 'linden-court', 'sea-point-atlantic', 'stellenbosch-oaks', 'durbanville-heights'],
        label: '8 schemes',
        grantedBy: 'Thandeka Mokoena',
        grantedAt: '2025-06-03T09:00:00+02:00',
      },
    ],
  },
  {
    id: 'p-kabelo',
    name: 'Kabelo Molefe',
    initials: 'KM',
    email: 'kabelo@acacia-ma.example',
    kind: 'customer',
    title: 'Portfolio Manager',
    staffId: 'staff-kabelo',
    assignments: [
      {
        id: 'm-kabelo',
        role: 'portfolio-manager',
        organisationId: 'acacia',
        schemeIds: ['protea-gardens', 'umhlanga-ridge', 'ballito-dunes', 'parkhurst-lofts', 'greenstone-commons', 'benoni-lakeside', 'bedfordview-place', 'kloof-forest'],
        label: '8 schemes',
        grantedBy: 'Thandeka Mokoena',
        grantedAt: '2025-06-03T09:00:00+02:00',
      },
    ],
  },
  {
    id: 'p-zanele',
    name: 'Zanele Dlamini',
    initials: 'ZD',
    email: 'zanele@acacia-ma.example',
    kind: 'customer',
    title: 'Credit Controller',
    staffId: 'staff-zanele',
    assignments: [
      { id: 'm-zanele', role: 'finance', organisationId: 'acacia', schemeIds: [], label: 'Credit Controller · All schemes', grantedBy: 'Thandeka Mokoena', grantedAt: '2025-07-15T09:00:00+02:00' },
    ],
  },
  {
    id: 'p-mpho',
    name: 'Mpho Sebe',
    initials: 'MS',
    email: 'mpho.sebe@mail.example',
    kind: 'customer',
    assignments: [
      { id: 'm-mpho', role: 'trustee', organisationId: 'acacia', schemeIds: ['the-willows'], label: 'Trustee · The Willows', grantedBy: 'Johan van der Merwe', grantedAt: '2026-03-18T18:00:00+02:00' },
    ],
  },
  {
    // Invited, hasn't signed in yet: the role is ready for them when they accept.
    id: 'p-karabo',
    name: 'Karabo Dlamini',
    initials: 'KD',
    email: 'karabo@acacia-ma.example',
    kind: 'customer',
    status: 'invited',
    title: 'Portfolio Manager',
    assignments: [
      { id: 'm-karabo', role: 'portfolio-manager', organisationId: 'acacia', schemeIds: ['bedfordview-place'], label: 'Bedfordview Place', grantedBy: 'Thandeka Mokoena', grantedAt: '2026-10-06T10:00:00+02:00' },
    ],
  },
  {
    id: 'p-annette',
    name: 'Annette Visser',
    initials: 'AV',
    email: 'annette@fynbos-pa.example',
    kind: 'customer',
    assignments: [
      { id: 'm-annette', role: 'agency-admin', organisationId: 'fynbos', schemeIds: [], label: 'Principal · Fynbos Property Admin', grantedBy: 'Humo onboarding', grantedAt: '2026-01-20T09:00:00+02:00' },
    ],
  },
  {
    id: 'p-dumisani',
    name: 'Dumisani Ngcobo',
    initials: 'DN',
    email: 'dumisani@humo.example',
    kind: 'humo',
    demo: true,
    assignments: [
      { id: 'm-dumisani', role: 'humo-account-manager', organisationId: null, schemeIds: [], label: 'Gauteng & KZN accounts', grantedBy: 'Terry Mosoma', grantedAt: '2026-02-02T09:00:00+02:00' },
    ],
  },
  {
    id: 'p-nomsa',
    name: 'Nomsa Khoza',
    initials: 'NK',
    email: 'nomsa@humo.example',
    kind: 'humo',
    demo: true,
    assignments: [
      { id: 'm-nomsa', role: 'humo-executive', organisationId: null, schemeIds: [], label: 'Chief Operating Officer', grantedBy: 'Terry Mosoma', grantedAt: '2026-01-12T09:00:00+02:00' },
      { id: 'm-nomsa-admin', role: 'system-admin', organisationId: null, schemeIds: [], label: 'Platform operations', grantedBy: 'Terry Mosoma', grantedAt: '2026-01-12T09:00:00+02:00' },
    ],
  },
  // Account managers named on customers (seed-platform ACCOUNT_MANAGERS); not offered in "Sign in as".
  {
    id: 'am-thabo',
    name: 'Thabo Mahlangu',
    initials: 'TM',
    email: 'thabo@humo.example',
    kind: 'humo',
    title: 'Account Manager',
    assignments: [{ id: 'm-thabo', role: 'humo-account-manager', organisationId: null, schemeIds: [], label: 'Western Cape accounts', grantedBy: 'Terry Mosoma', grantedAt: '2026-03-16T09:00:00+02:00' }],
  },
  {
    id: 'am-carla',
    name: 'Carla de Wet',
    initials: 'CW',
    email: 'carla@humo.example',
    kind: 'humo',
    title: 'Account Manager',
    assignments: [{ id: 'm-carla', role: 'humo-account-manager', organisationId: null, schemeIds: [], label: 'Free State & Eastern Cape accounts', grantedBy: 'Terry Mosoma', grantedAt: '2026-04-06T09:00:00+02:00' }],
  },
];

/** "Unit 42" in Kingfisher Court → the unit's id, "unit-kc-042". */
function unitIdFor(schemeId: string, unit: string): string {
  const code = SCHEMES.find((x) => x.id === schemeId)?.code ?? schemeId;
  return `unit-${code.toLowerCase()}-${unit.replace(/\D/g, '').padStart(3, '0')}`;
}

function toAssignment(a: SeedAssignment): RoleAssignment {
  const { organisationId, schemeIds, unit, status, ...rest } = a;
  const type: ScopeType = isHumoRole(a.role) ? 'platform' : unit ? 'unit' : schemeIds.length ? 'schemes' : 'organisation';
  return {
    ...rest,
    version: 1,
    status: status ?? 'active',
    scope: { type, organisationId, schemeIds, ...(unit ? { unitId: unitIdFor(schemeIds[0], unit) } : {}) },
  };
}

function toIdentity(seed: SeedIdentity): Identity {
  const assignments = seed.assignments.map(toAssignment);
  const orgs = [...new Set(assignments.map((a) => a.scope.organisationId).filter((x): x is string => !!x))];
  return {
    ...seed,
    version: 1,
    status: seed.status ?? 'active',
    assignments,
    memberships: orgs.map((organisationId) => ({
      organisationId,
      status: 'active',
      since: assignments.filter((a) => a.scope.organisationId === organisationId).map((a) => a.grantedAt ?? '').sort()[0],
    })),
  };
}

export const PERSONAS: Identity[] = SEED.map(toIdentity);
