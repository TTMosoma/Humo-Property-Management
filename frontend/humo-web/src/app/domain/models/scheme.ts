export type SchemeType = 'Sectional Title' | 'Home Owners Association' | 'Share Block';

/** A community scheme (body corporate, HOA or share block) managed by an agency. */
export interface Scheme {
  id: string;
  agencyId: string;
  name: string;
  /** Short code used in unit/account references, e.g. "KC" → account KC-042. */
  code: string;
  type: SchemeType;
  suburb: string;
  city: string;
  province: string;
  unitCount: number;
  portfolioManagerId: string;
}
