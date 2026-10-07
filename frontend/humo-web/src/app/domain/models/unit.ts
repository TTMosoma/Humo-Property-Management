export type Occupancy = 'owner-occupied' | 'tenanted' | 'vacant';

/** A section (sectional title), erf (HOA) or share block within a scheme. */
export interface Unit {
  id: string;
  schemeId: string;
  /** As people say it: "42". */
  number: string;
  /** Levy account number, e.g. "KC-042". Also the payment reference owners should use. */
  accountNo: string;
  block?: string;
  floor?: number;
  description: string;
  sizeM2: number;
  /** Participation quota (%), which determines the share of levies. */
  participationQuota: number;
  monthlyLevy: number;
  occupancy: Occupancy;
  parkingBays: string[];
}

/** "KC 42" — how agents refer to a unit across schemes. */
export function unitLabel(code: string, unit: Pick<Unit, 'number'>): string {
  return `${code} ${unit.number}`;
}
