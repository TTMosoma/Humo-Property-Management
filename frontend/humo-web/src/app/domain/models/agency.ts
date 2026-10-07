/** A managing agency — a customer (tenant) of the Humo platform. Its package and features live on its Subscription. */
export interface Agency {
  id: string;
  name: string;
  shortName: string;
  city: string;
  province: string;
  schemeCount: number;
  unitCount: number;
}
