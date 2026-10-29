import { Router } from '@angular/router';
import { BankAccountType, SUPPLIER_STATUS_LABELS, Scheme, Supplier, SupplierDataSource, SupplierDetails, SupplierStatus, Trade } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FormField, FormValues, REASON_FIELD, openForm } from '../shared/form-drawer';

const TRADES: Trade[] = ['Plumbing', 'Electrical', 'Roofing & waterproofing', 'Painting', 'Security', 'Gate automation', 'Lifts', 'Gardens', 'Pools', 'Pest control', 'Building', 'Fire equipment'];

function fields(schemes: Scheme[]): FormField[] {
  const trades = TRADES.map((t) => ({ value: t, label: t }));
  return [
    { key: 'name', label: 'Business name', type: 'text', required: true },
    { key: 'trade', label: 'Main trade', type: 'select', required: true, half: true, options: trades },
    { key: 'trade2', label: 'Also does', type: 'select', half: true, options: trades },
    { key: 'contactName', label: 'Contact person', type: 'text', required: true },
    { key: 'phone', label: 'Phone', type: 'tel', required: true, half: true },
    { key: 'email', label: 'Email', type: 'email', required: true, half: true, help: 'Work orders and remittances go here.' },
    {
      key: 'where', label: 'Works at', type: 'select', required: true,
      options: [{ value: 'all', label: 'All my schemes' }, ...schemes.map((s) => ({ value: s.id, label: s.name }))],
    },
    { key: 'bbbeeLevel', label: 'B-BBEE level', type: 'number', half: true, help: '1 to 8, from their certificate.' },
  ];
}

function detailsFrom(v: FormValues, schemes: Scheme[]): SupplierDetails {
  return {
    name: v['name'],
    trades: [...new Set([v['trade'], v['trade2']].filter(Boolean))] as Trade[],
    contactName: v['contactName'],
    phone: v['phone'],
    email: v['email'],
    schemeIds: v['where'] === 'all' ? schemes.map((s) => s.id) : [v['where']],
    bbbeeLevel: v['bbbeeLevel'] ? Number(v['bbbeeLevel']) : undefined,
  };
}

export function newSupplierForm(drawer: DrawerService, data: SupplierDataSource, schemes: Scheme[], router: Router): void {
  openForm(drawer, {
    eyebrow: 'Suppliers',
    title: 'Add a supplier',
    intro: 'A business you vet yourself. Their documents start as missing: request them from the supplier page before issuing work orders. (Businesses on Humo Contractor are added when you accept their quote.)',
    fields: fields(schemes),
    initial: { trade: 'Plumbing', where: 'all' },
    submitLabel: 'Add supplier',
    submit: (v) => data.create(detailsFrom(v, schemes)),
    success: (_id, v) => `${v['name']} added. Next: request their vetting documents.`,
    done: (id) => router.navigate(['/suppliers', id]),
    failure: 'The supplier wasn’t added',
  });
}

export function editSupplierForm(drawer: DrawerService, data: SupplierDataSource, s: Supplier, schemes: Scheme[]): void {
  const everywhere = schemes.length > 0 && schemes.every((x) => s.schemeIds.includes(x.id));
  openForm(drawer, {
    eyebrow: s.name,
    title: 'Edit supplier',
    intro: 'Banking details are changed separately, with verification.',
    fields: fields(schemes),
    initial: {
      name: s.name, trade: s.trades[0] ?? '', trade2: s.trades[1] ?? '', contactName: s.contactName, phone: s.phone, email: s.email,
      where: everywhere ? 'all' : (s.schemeIds[0] ?? 'all'), bbbeeLevel: s.bbbeeLevel ? String(s.bbbeeLevel) : '',
    },
    submitLabel: 'Save supplier',
    submit: (v) => data.update(s.id, detailsFrom(v, schemes), s.version),
    success: () => 'Supplier saved.',
    failure: 'The supplier wasn’t saved',
  });
}

const COPY: Record<SupplierStatus, { title: string; intro: string; button: string }> = {
  'on-hold': { title: 'Put on hold', intro: 'No new work orders go to them until the hold is released. Open jobs and payments carry on.', button: 'Put on hold' },
  active: { title: 'Release the hold', intro: 'They can be given new work again.', button: 'Release hold' },
  archived: { title: 'Archive supplier', intro: 'You no longer use them. They’re hidden from lists and pickers; their jobs, invoices and payments stay on record.', button: 'Archive' },
};

export function supplierStatusForm(drawer: DrawerService, data: SupplierDataSource, s: Supplier, status: SupplierStatus): void {
  const restoring = s.status === 'archived';
  const copy = restoring ? { title: 'Restore supplier', intro: 'They come back to your lists, as active.', button: 'Restore' } : COPY[status];
  openForm(drawer, {
    eyebrow: `${s.name} · ${SUPPLIER_STATUS_LABELS[s.status]}`,
    title: copy.title,
    intro: copy.intro,
    fields: [REASON_FIELD],
    submitLabel: copy.button,
    submit: (v) => data.setStatus(s.id, status, v['reason'], s.version),
    success: () => `${s.name} is ${SUPPLIER_STATUS_LABELS[status].toLowerCase()}.`,
    failure: 'The supplier wasn’t changed',
  });
}

const BANKS = ['Absa', 'African Bank', 'Bidvest Bank', 'Capitec Business', 'Discovery Bank', 'FNB', 'Investec', 'Nedbank', 'Standard Bank', 'TymeBank'];

/**
 * The account a supplier is paid into (D27): a fresh passkey to enter it, then payments are held until someone else
 * verifies it in My work, after calling the supplier back on the number already on file.
 */
export function bankDetailsForm(drawer: DrawerService, data: SupplierDataSource, s: Supplier): void {
  openForm(drawer, {
    eyebrow: s.name,
    title: 'Enter bank details',
    intro: `Take them from the supplier’s bank confirmation letter, never from an email asking you to change them. Payments to ${s.name} are held until someone else verifies the account in My work, after calling ${s.contactName} on ${s.phone}.`,
    fields: [
      { key: 'bankName', label: 'Bank', type: 'select', required: true, half: true, options: BANKS.map((b) => ({ value: b, label: b })) },
      { key: 'branchCode', label: 'Branch code', type: 'text', required: true, half: true, help: '6 digits, e.g. 250655.' },
      { key: 'accountNumber', label: 'Account number', type: 'text', required: true, half: true },
      {
        key: 'accountType', label: 'Account type', type: 'select', required: true, half: true,
        options: [{ value: 'cheque', label: 'Cheque / current' }, { value: 'savings', label: 'Savings' }, { value: 'transmission', label: 'Transmission' }],
      },
      { key: 'accountHolder', label: 'Account holder', type: 'text', required: true, help: 'The name the bank has on the account.' },
    ],
    initial: { bankName: 'FNB', accountType: 'cheque', accountHolder: s.name },
    submitLabel: 'Enter bank details',
    stepUp: { action: 'change-bank-details', detail: `Change the bank account ${s.name} is paid into` },
    submit: (v) =>
      data.changeBankDetails(s.id, {
        bankName: v['bankName'],
        branchCode: v['branchCode'].replace(/\s/g, ''),
        accountNumber: v['accountNumber'].replace(/\s/g, ''),
        accountType: v['accountType'] as BankAccountType,
        accountHolder: v['accountHolder'],
      }),
    success: () => `Entered. Payments to ${s.name} are held until someone else verifies the account in My work.`,
    failure: 'The bank details weren’t changed',
  });
}
