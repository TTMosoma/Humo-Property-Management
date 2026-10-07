export interface StaffMember {
  id: string;
  name: string;
  initials: string;
  title: string;
}

/** Acacia Managing Agents' team. Ids match Scheme.portfolioManagerId and work item assignees. */
export const STAFF: StaffMember[] = [
  { id: 'staff-thandeka', name: 'Thandeka Mokoena', initials: 'TM', title: 'Director' },
  { id: 'staff-johan', name: 'Johan van der Merwe', initials: 'JM', title: 'Portfolio Manager' },
  { id: 'staff-naledi', name: 'Naledi Sithole', initials: 'NS', title: 'Portfolio Manager' },
  { id: 'staff-kabelo', name: 'Kabelo Molefe', initials: 'KM', title: 'Portfolio Manager' },
  { id: 'staff-priya', name: 'Priya Naidoo', initials: 'PN', title: 'Senior Accountant' },
  { id: 'staff-zanele', name: 'Zanele Dlamini', initials: 'ZD', title: 'Credit Controller' },
  { id: 'staff-sarah', name: 'Sarah Jacobs', initials: 'SJ', title: 'Operations Director' },
  { id: 'staff-bongani', name: 'Bongani Ndlovu', initials: 'BN', title: 'Maintenance Coordinator' },
];

const OTHERS: Record<string, string> = { 'p-sipho': 'Sipho Khumalo (trustee)' };

export function personName(id: string | null | undefined): string {
  if (!id) return 'Unassigned';
  return STAFF.find((s) => s.id === id)?.name ?? OTHERS[id] ?? id;
}
