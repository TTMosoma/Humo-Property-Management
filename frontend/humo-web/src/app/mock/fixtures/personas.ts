import { Persona } from '../../domain';

const KC = 'kingfisher-court';

/** One persona per role (plus multi-role people), so every experience can be reviewed. */
export const PERSONAS: Persona[] = [
  {
    id: 'p-lerato',
    name: 'Lerato Dube',
    initials: 'LD',
    email: 'lerato.dube@humo.example',
    memberships: [
      { id: 'm-lerato', role: 'system-admin', agencyId: null, schemeIds: [], label: 'Humo platform operations' },
    ],
  },
  {
    id: 'p-thandeka',
    name: 'Thandeka Mokoena',
    initials: 'TM',
    email: 'thandeka@acacia-ma.example',
    staffId: 'staff-thandeka',
    memberships: [
      { id: 'm-thandeka', role: 'agency-admin', agencyId: 'acacia', schemeIds: [], label: 'Director · Acacia Managing Agents' },
    ],
  },
  {
    id: 'p-johan',
    name: 'Johan van der Merwe',
    initials: 'JM',
    email: 'johan@acacia-ma.example',
    staffId: 'staff-johan',
    memberships: [
      {
        id: 'm-johan',
        role: 'portfolio-manager',
        agencyId: 'acacia',
        schemeIds: [
          KC,
          'the-willows',
          'rosebank-terraces',
          'midrand-crossing',
          'northcliff-view',
          'craighall-mews',
          'lonehill-village',
          'morningside-manor',
        ],
        label: 'Portfolio Manager · 8 schemes',
      },
    ],
  },
  {
    id: 'p-priya',
    name: 'Priya Naidoo',
    initials: 'PN',
    email: 'priya@acacia-ma.example',
    staffId: 'staff-priya',
    memberships: [
      { id: 'm-priya', role: 'finance', agencyId: 'acacia', schemeIds: [], label: 'Senior Accountant · Acacia Managing Agents' },
    ],
  },
  {
    // Multi-role: chairperson of the trustees AND an owner in the same scheme.
    id: 'p-sipho',
    name: 'Sipho Khumalo',
    initials: 'SK',
    email: 'sipho.khumalo@mail.example',
    personId: 'per-sipho',
    memberships: [
      { id: 'm-sipho-trustee', role: 'trustee', agencyId: 'acacia', schemeIds: [KC], label: 'Chairperson · Kingfisher Court' },
      { id: 'm-sipho-owner', role: 'owner', agencyId: 'acacia', schemeIds: [KC], unitLabel: 'Unit 12', label: 'Owner · Unit 12, Kingfisher Court' },
    ],
  },
  {
    // Multi-unit owner across two schemes.
    id: 'p-anele',
    name: 'Anele Mthembu',
    initials: 'AM',
    email: 'anele.m@mail.example',
    personId: 'per-anele',
    memberships: [
      { id: 'm-anele-kc', role: 'owner', agencyId: 'acacia', schemeIds: [KC], unitLabel: 'Unit 42', label: 'Owner · Unit 42, Kingfisher Court' },
      { id: 'm-anele-de', role: 'owner', agencyId: 'acacia', schemeIds: ['stellenbosch-oaks'], unitLabel: 'Unit 7', label: 'Owner · Unit 7, Die Eike' },
    ],
  },
  {
    id: 'p-ruan',
    name: 'Ruan Botha',
    initials: 'RB',
    email: 'ruan.botha@mail.example',
    personId: 'per-ruan',
    memberships: [
      { id: 'm-ruan', role: 'tenant', agencyId: 'acacia', schemeIds: [KC], unitLabel: 'Unit 17', label: 'Tenant · Unit 17, Kingfisher Court' },
    ],
  },
];
