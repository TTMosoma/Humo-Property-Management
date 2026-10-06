import { Agency } from '../../domain';

/** Fictional agencies. Real customers (e.g. Tshikrand) would simply be additional records here. */
export const AGENCIES: Agency[] = [
  {
    id: 'acacia',
    name: 'Acacia Managing Agents (Pty) Ltd',
    shortName: 'Acacia Managing Agents',
    city: 'Johannesburg',
    province: 'Gauteng',
    schemeCount: 24,
    unitCount: 1284,
    plan: 'Professional',
  },
  {
    id: 'fynbos',
    name: 'Fynbos Property Administrators',
    shortName: 'Fynbos Property Admin',
    city: 'Cape Town',
    province: 'Western Cape',
    schemeCount: 11,
    unitCount: 486,
    plan: 'Starter',
  },
  {
    id: 'umgeni',
    name: 'Umgeni Body Corporate Services',
    shortName: 'Umgeni BC Services',
    city: 'Durban',
    province: 'KwaZulu-Natal',
    schemeCount: 17,
    unitCount: 902,
    plan: 'Professional',
  },
];
