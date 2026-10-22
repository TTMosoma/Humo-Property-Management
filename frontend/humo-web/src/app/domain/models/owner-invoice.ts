/**
 * An invoice an agency issues to an owner for one of their units (basic invoicing, Essentials, D17). Issuing it charges
 * the unit's levy account; a payment recorded by hand credits it. Invoices are numbered per agency: INV-0001 onwards.
 */
export interface OwnerInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface OwnerInvoicePayment {
  date: string;
  amount: number;
  reference: string | null;
  recordedBy: string;
}

export interface OwnerInvoice {
  id: string;
  number: string;
  accountId: string;
  accountNo: string;
  schemeId: string;
  date: string;
  dueOn: string;
  lines: OwnerInvoiceLine[];
  total: number;
  paid: number;
  outstanding: number;
  status: 'issued' | 'paid';
  payments: OwnerInvoicePayment[];
  emailedAt: string | null;
  version: number;
}

export interface NewOwnerInvoice {
  unitId: string;
  date: string;
  dueOn: string;
  lines: { description: string; quantity: number; unitPrice: number }[];
}
