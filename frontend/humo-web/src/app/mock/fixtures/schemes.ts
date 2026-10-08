import { Scheme, SchemeType } from '../../domain';

const ST: SchemeType = 'Sectional Title';
const HOA: SchemeType = 'Home Owners Association';
const SB: SchemeType = 'Share Block';

function scheme(
  id: string,
  name: string,
  code: string,
  type: SchemeType,
  suburb: string,
  city: string,
  province: string,
  unitCount: number,
  _seedManager: string,
): Scheme {
  // The manager comes from portfolio-manager assignments (see portfolioManagerOf); the seed column documents the intent.
  return { id, organisationId: 'acacia', name, code, type, status: 'active', suburb, city, province, unitCount, portfolioManager: null };
}

// 24 schemes, 1 284 units in total, for the demo agency.
export const SCHEMES: Scheme[] = [
  scheme('kingfisher-court', 'Kingfisher Court', 'KC', ST, 'Bryanston', 'Sandton', 'Gauteng', 64, 'staff-johan'),
  scheme('jacaranda-heights', 'Jacaranda Heights', 'JH', ST, 'Hatfield', 'Pretoria', 'Gauteng', 48, 'staff-naledi'),
  scheme('waterkloof-ridge', 'Waterkloof Ridge Estate', 'WRE', HOA, 'Waterkloof', 'Pretoria', 'Gauteng', 84, 'staff-naledi'),
  scheme('silverlakes-manor', 'Silverlakes Manor', 'SLM', HOA, 'Silver Lakes', 'Pretoria', 'Gauteng', 86, 'staff-naledi'),
  scheme('the-willows', 'The Willows', 'TW', ST, 'Fourways', 'Johannesburg', 'Gauteng', 72, 'staff-johan'),
  scheme('rosebank-terraces', 'Rosebank Terraces', 'RT', ST, 'Rosebank', 'Johannesburg', 'Gauteng', 40, 'staff-johan'),
  scheme('protea-gardens', 'Protea Gardens', 'PG', ST, 'Randburg', 'Johannesburg', 'Gauteng', 36, 'staff-kabelo'),
  scheme('umhlanga-ridge', 'Umhlanga Ridge Villas', 'URV', ST, 'Umhlanga', 'Durban', 'KwaZulu-Natal', 54, 'staff-kabelo'),
  scheme('ballito-dunes', 'Ballito Dunes Estate', 'BDE', HOA, 'Ballito', 'KwaDukuza', 'KwaZulu-Natal', 96, 'staff-kabelo'),
  scheme('midrand-crossing', 'Midrand Crossing', 'MC', ST, 'Halfway House', 'Midrand', 'Gauteng', 60, 'staff-johan'),
  scheme('northcliff-view', 'Northcliff View', 'NV', ST, 'Northcliff', 'Johannesburg', 'Gauteng', 28, 'staff-johan'),
  scheme('craighall-mews', 'Craighall Mews', 'CM', ST, 'Craighall Park', 'Johannesburg', 'Gauteng', 20, 'staff-johan'),
  scheme('parkhurst-lofts', 'Parkhurst Lofts', 'PL', ST, 'Parkhurst', 'Johannesburg', 'Gauteng', 24, 'staff-kabelo'),
  scheme('greenstone-commons', 'Greenstone Commons', 'GC', ST, 'Edenvale', 'Ekurhuleni', 'Gauteng', 72, 'staff-kabelo'),
  scheme('benoni-lakeside', 'Benoni Lakeside', 'BL', HOA, 'Lakefield', 'Benoni', 'Gauteng', 78, 'staff-kabelo'),
  scheme('centurion-palms', 'Centurion Palms', 'CP', ST, 'Highveld', 'Centurion', 'Gauteng', 56, 'staff-naledi'),
  scheme('lonehill-village', 'Lonehill Village', 'LV', HOA, 'Lonehill', 'Sandton', 'Gauteng', 64, 'staff-johan'),
  scheme('bedfordview-place', 'Bedfordview Place', 'BP', ST, 'Bedfordview', 'Ekurhuleni', 'Gauteng', 32, 'staff-kabelo'),
  scheme('morningside-manor', 'Morningside Manor', 'MM', ST, 'Morningside', 'Sandton', 'Gauteng', 44, 'staff-johan'),
  scheme('linden-court', 'Linden Court Share Block', 'LC', SB, 'Linden', 'Johannesburg', 'Gauteng', 26, 'staff-naledi'),
  scheme('sea-point-atlantic', 'Atlantic Mansions', 'AM', ST, 'Sea Point', 'Cape Town', 'Western Cape', 58, 'staff-naledi'),
  scheme('stellenbosch-oaks', 'Die Eike', 'DE', ST, 'Die Boord', 'Stellenbosch', 'Western Cape', 46, 'staff-naledi'),
  scheme('durbanville-heights', 'Durbanville Heights', 'DH', HOA, 'Durbanville', 'Cape Town', 'Western Cape', 42, 'staff-naledi'),
  scheme('kloof-forest', 'Kloof Forest Estate', 'KFE', HOA, 'Kloof', 'eThekwini', 'KwaZulu-Natal', 54, 'staff-kabelo'),
];

export function findScheme(id: string | null | undefined): Scheme | undefined {
  return id ? SCHEMES.find((s) => s.id === id) : undefined;
}
