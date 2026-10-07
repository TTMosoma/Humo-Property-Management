import { AppNotification, Role } from '../../domain';

const STAFF: Role[] = ['agency-admin', 'portfolio-manager', 'finance'];
const STAFF_TRUSTEE: Role[] = [...STAFF, 'trustee'];

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

/**
 * Notifications are scoped: each carries a scheme and an audience, and the
 * shell only shows those the current membership is entitled to see.
 */
export const NOTIFICATIONS: AppNotification[] = [
  {
    id: 'n1',
    kind: 'maintenance',
    title: 'Quote received — gate motor replacement',
    detail: 'Gate Automation SA quoted R 18 900.00 for the main entrance.',
    schemeId: 'the-willows',
    audience: ['agency-admin', 'portfolio-manager'],
    at: hoursAgo(1.5),
    read: false,
    link: '/approvals',
  },
  {
    id: 'n2',
    kind: 'finance',
    title: 'Bank import complete — 17 receipts need allocating',
    detail: '214 receipts imported; 197 matched automatically.',
    schemeId: null,
    audience: ['agency-admin', 'finance'],
    at: hoursAgo(3),
    read: false,
    link: '/finance/receipts',
  },
  {
    id: 'n3',
    kind: 'compliance',
    title: 'Insurance renewal due in 5 days',
    detail: 'Building policy renewal for Jacaranda Heights.',
    schemeId: 'jacaranda-heights',
    audience: STAFF,
    at: hoursAgo(16),
    read: false,
    link: '/compliance',
  },
  {
    id: 'n4',
    kind: 'governance',
    title: 'Trustee approved invoice INV-20931',
    detail: 'Sipho Khumalo approved R 6 420.00 to Secure-Rite Security.',
    schemeId: 'kingfisher-court',
    audience: STAFF_TRUSTEE,
    at: hoursAgo(22),
    read: true,
    link: '/finance/payables',
  },
  {
    id: 'n5',
    kind: 'maintenance',
    title: 'Roof waterproofing: 3rd quote received',
    detail: 'All quotes are in for MR-1042 — ready for trustee approval.',
    schemeId: 'kingfisher-court',
    audience: STAFF_TRUSTEE,
    at: hoursAgo(26),
    read: false,
    link: '/approvals',
  },
  {
    id: 'n6',
    kind: 'communication',
    title: 'New message from owner, Unit 8',
    detail: '“Please confirm when the lift will be repaired…”',
    schemeId: 'rosebank-terraces',
    audience: ['agency-admin', 'portfolio-manager'],
    at: hoursAgo(40),
    read: true,
    link: '/inbox',
  },

  // ---- Residents (Kingfisher Court) ----
  {
    id: 'r1',
    kind: 'finance',
    title: 'Your October statement is ready',
    detail: 'Amount due R 4 812.50 by 7 October.',
    schemeId: 'kingfisher-court',
    audience: ['owner'],
    unitLabel: 'Unit 42',
    at: hoursAgo(5),
    read: false,
    link: '/my/account',
  },
  {
    id: 'r2',
    kind: 'communication',
    title: 'Water off Thursday 09:00–13:00',
    detail: 'Rand Water maintenance in Bryanston. Please store water.',
    schemeId: 'kingfisher-court',
    audience: ['owner', 'tenant'],
    at: hoursAgo(20),
    read: false,
    link: '/my/notices',
  },
  {
    id: 'r3',
    kind: 'maintenance',
    title: 'Your request MR-1033 was completed',
    detail: 'Passage light outside Unit 17 replaced. Was it fixed?',
    schemeId: 'kingfisher-court',
    audience: ['tenant'],
    unitLabel: 'Unit 17',
    at: hoursAgo(30),
    read: false,
    link: '/my/requests',
  },
];
