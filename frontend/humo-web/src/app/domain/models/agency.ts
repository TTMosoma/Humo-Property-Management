/** A managing agency — a customer (tenant) of the Humo platform. */
export interface Agency {
  id: string;
  name: string;
  shortName: string;
  city: string;
  province: string;
  schemeCount: number;
  unitCount: number;
  plan: 'Starter' | 'Professional' | 'Enterprise';
}
