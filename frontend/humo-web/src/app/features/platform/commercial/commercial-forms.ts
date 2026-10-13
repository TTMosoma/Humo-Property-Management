import {
  ADJUSTMENT_LABELS,
  AddOnKind,
  AdjustmentKind,
  BILLING_PREFERENCE_HELP,
  BILLING_PREFERENCE_LABELS,
  BillingPreference,
  CommercialAddOn,
  CommercialDataSource,
  CommercialPackage,
  CommercialSettings,
  CustomerCommercialView,
  CustomerInvoice,
  FEATURES,
  Feature,
  PRICE_STATUS_LABELS,
  PRORATION_LABELS,
  PaymentRecord,
  PriceStatus,
  ProrationPolicy,
  termsOn,
} from '../../../domain';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { formatRand } from '../../../ui/format/money';
import { FormValues, REASON_FIELD, openForm, today } from '../../shared/form-drawer';

const num = (v: string | undefined): number | null => (v === undefined || v.trim() === '' ? null : Number(v.replace(/[\s,]/g, '')));
const PRICE_STATUS_OPTIONS = (Object.keys(PRICE_STATUS_LABELS) as PriceStatus[]).map((s) => ({ value: s, label: PRICE_STATUS_LABELS[s] }));
const SUBSCRIPTION_STEP_UP = (v: CustomerCommercialView, what: string) => ({ action: 'change-subscription' as const, detail: `${what} for ${v.name}` });

// ---------------------------------------------------------------- A customer's agreement

export function adjustmentForm(drawer: DrawerService, data: CommercialDataSource, v: CustomerCommercialView): void {
  openForm(drawer, {
    eyebrow: `${v.name} · Agreement`,
    title: 'Discount, credit or once-off fee',
    intro: 'A discount reduces the recurring total while it applies. A credit or once-off fee goes on the next invoice only. Each is recorded with your name and reason.',
    fields: [
      { key: 'kind', label: 'Type', type: 'select', required: true, options: (Object.keys(ADJUSTMENT_LABELS) as AdjustmentKind[]).map((k) => ({ value: k, label: ADJUSTMENT_LABELS[k] })) },
      { key: 'label', label: 'As it appears on the invoice', type: 'text', required: true, placeholder: 'e.g. Loyalty discount, Data migration' },
      { key: 'amount', label: 'Amount (rand, excl. tax)', type: 'number', half: true, requiredIf: (f) => f['kind'] !== 'discount' || !f['percent'] },
      { key: 'percent', label: 'Or percent off', type: 'number', half: true, showIf: (f) => f['kind'] === 'discount' },
      { key: 'from', label: 'From', type: 'date', required: true, half: true },
      { key: 'until', label: 'Until', type: 'date', half: true, showIf: (f) => f['kind'] === 'discount', help: 'Leave empty for an open-ended discount.' },
      REASON_FIELD,
    ],
    initial: { kind: 'discount', from: v.agreement.billing.nextBillingDate },
    submitLabel: 'Add to the agreement',
    stepUp: SUBSCRIPTION_STEP_UP(v, 'Add a discount, credit or fee'),
    submit: (f) =>
      data.change(
        v.organisationId,
        {
          type: 'adjustment',
          kind: f['kind'] as AdjustmentKind,
          label: f['label'],
          amount: num(f['amount']) ?? 0,
          percent: f['kind'] === 'discount' && f['percent'] ? (num(f['percent']) ?? undefined) : undefined,
          from: f['from'],
          until: f['until'] || undefined,
          reason: f['reason'],
        },
        v.agreement.version,
      ),
    success: (_r, f) => `${ADJUSTMENT_LABELS[f['kind'] as AdjustmentKind]} added.`,
    failure: 'The agreement wasn’t changed',
  });
}

export function billingPreferenceForm(drawer: DrawerService, data: CommercialDataSource, v: CustomerCommercialView): void {
  openForm(drawer, {
    eyebrow: `${v.name} · Billing`,
    title: 'How they pay',
    intro: 'The billing preference is how the customer likes to pay. Whether a particular invoice is paid is recorded separately, from verified payments only.',
    fields: [
      {
        key: 'preference',
        label: 'Billing preference',
        type: 'select',
        required: true,
        options: (Object.keys(BILLING_PREFERENCE_LABELS) as BillingPreference[]).map((p) => ({ value: p, label: BILLING_PREFERENCE_LABELS[p] })),
        help: 'Recurring card is the intended default, where the provider and the customer’s mandate support it. Manual EFT invoices are paid only once reconciled.',
      },
      { key: 'billingEmail', label: 'Invoices go to', type: 'email', required: true },
      REASON_FIELD,
    ],
    initial: { preference: v.agreement.billing.preference, billingEmail: v.agreement.billing.billingEmail },
    submitLabel: 'Save',
    stepUp: SUBSCRIPTION_STEP_UP(v, 'Change the billing preference'),
    submit: (f) => data.change(v.organisationId, { type: 'billing-preference', preference: f['preference'] as BillingPreference, billingEmail: f['billingEmail'], reason: f['reason'] }, v.agreement.version),
    success: (_r, f) => `${BILLING_PREFERENCE_LABELS[f['preference'] as BillingPreference]}. ${BILLING_PREFERENCE_HELP[f['preference'] as BillingPreference]}`,
    failure: 'The billing preference wasn’t changed',
  });
}

export function renewalForm(drawer: DrawerService, data: CommercialDataSource, v: CustomerCommercialView): void {
  openForm(drawer, {
    eyebrow: `${v.name} · Agreement`,
    title: 'Annual renewal fee',
    intro: 'Charged once a year, on the invoice whose period includes the renewal date. It isn’t part of the monthly recurring total. After it’s invoiced, the renewal moves on a year.',
    fields: [
      { key: 'fee', label: 'Renewal fee (rand, excl. tax)', type: 'number', half: true, help: 'Leave empty for no renewal fee.' },
      { key: 'on', label: 'Next renewal', type: 'date', required: true, half: true },
      REASON_FIELD,
    ],
    initial: { fee: v.agreement.renewal.fee == null ? '' : String(v.agreement.renewal.fee), on: v.agreement.renewal.on },
    submitLabel: 'Save',
    stepUp: SUBSCRIPTION_STEP_UP(v, 'Change the annual renewal fee'),
    submit: (f) => data.change(v.organisationId, { type: 'renewal', fee: num(f['fee']), on: f['on'], reason: f['reason'] }, v.agreement.version),
    success: (_r, f) => (f['fee'] ? `Renewal fee of ${formatRand(num(f['fee']) ?? 0)} on ${f['on']}.` : 'No renewal fee.'),
    failure: 'The renewal fee wasn’t saved',
  });
}

export function storageExceptionForm(drawer: DrawerService, data: CommercialDataSource, v: CustomerCommercialView): void {
  const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  openForm(drawer, {
    eyebrow: `${v.name} · Storage`,
    title: 'Temporary storage exception',
    intro: 'Extra storage for a limited time, at no charge, e.g. while a storage pack is agreed. It ends on its date; nothing is charged or upgraded automatically.',
    fields: [
      { key: 'extraGb', label: 'Extra storage (GB)', type: 'number', required: true, half: true },
      { key: 'until', label: 'Until', type: 'date', required: true, half: true },
      REASON_FIELD,
    ],
    initial: { extraGb: '5', until: inTwoWeeks },
    submitLabel: 'Grant exception',
    stepUp: SUBSCRIPTION_STEP_UP(v, 'Grant a storage exception'),
    submit: (f) => data.change(v.organisationId, { type: 'storage-exception', extraGb: num(f['extraGb']) ?? 0, until: f['until'], reason: f['reason'] }, v.agreement.version),
    success: (_r, f) => `${f['extraGb']} GB granted until ${f['until']}.`,
    failure: 'The exception wasn’t granted',
  });
}

export function eftProofForm(drawer: DrawerService, data: CommercialDataSource, v: CustomerCommercialView, inv: CustomerInvoice): void {
  openForm(drawer, {
    eyebrow: `${v.name} · ${inv.reference}`,
    title: 'Record proof of EFT payment',
    intro: 'The invoice stays unpaid until someone with billing authority matches the payment to Humo’s bank statement.',
    fields: [{ key: 'note', label: 'What the customer sent', type: 'textarea', required: true, placeholder: 'e.g. Proof of payment emailed by Annette on 10 October, FNB reference HPM-FYN-202610' }],
    submitLabel: 'Record proof',
    submit: (f) => data.recordEftProof(inv.id, f['note']),
    success: () => 'Recorded. The invoice is unpaid until the payment is verified.',
    failure: 'The proof of payment wasn’t recorded',
  });
}

export function reconcileForm(drawer: DrawerService, data: CommercialDataSource, v: CustomerCommercialView, p: PaymentRecord): void {
  openForm(drawer, {
    eyebrow: `${v.name} · Payment`,
    title: 'Verify against the bank statement',
    intro: `Only mark this verified once ${formatRand(p.amount)} is on Humo’s bank statement. In the demo there is no bank feed: this records the check, it doesn’t perform it.`,
    fields: [{ key: 'bankReference', label: 'Bank statement line reference', type: 'text', required: true, placeholder: 'e.g. FNB 2026-10-13 HPM-FYN-202610' }],
    submitLabel: 'Mark verified',
    stepUp: { action: 'verify-payment', detail: `Verify ${formatRand(p.amount)} from ${v.name}` },
    submit: (f) => data.reconcileEft(p.id, f['bankReference']),
    success: () => 'Verified. The invoice is paid.',
    failure: 'The payment wasn’t verified',
  });
}

// ---------------------------------------------------------------- Catalogue

export function packageTermsForm(drawer: DrawerService, data: CommercialDataSource, p: CommercialPackage, name: string): void {
  const t = termsOn(p.terms, today()) ?? p.terms[0];
  const s = (n: number | null | undefined) => (n == null ? '' : String(n));
  openForm(drawer, {
    eyebrow: `${name} · Commercial terms`,
    title: 'New terms',
    intro: 'Terms take effect from a date and are kept as a new version. Existing customers keep the price they agreed; only new agreements from that date use these terms.',
    fields: [
      { key: 'effectiveFrom', label: 'Effective from', type: 'date', required: true, half: true },
      { key: 'priceStatus', label: 'Price status', type: 'select', required: true, half: true, options: PRICE_STATUS_OPTIONS },
      { key: 'monthlyPrice', label: 'Monthly price (rand, excl. tax)', type: 'number', half: true, help: 'Leave empty while awaiting configuration.' },
      { key: 'annualPrice', label: 'Annual price', type: 'number', half: true },
      { key: 'includedStorageGb', label: 'Included storage (GB)', type: 'number', half: true, help: 'Empty: negotiated per customer.' },
      { key: 'storageStatus', label: 'Storage status', type: 'select', required: true, half: true, options: PRICE_STATUS_OPTIONS },
      { key: 'includedSchemes', label: 'Schemes included', type: 'number', half: true, help: 'Empty: not priced by portfolio size.' },
      { key: 'extraSchemePrice', label: 'Per extra scheme, a month', type: 'number', half: true },
      { key: 'annualRenewalFee', label: 'Annual renewal fee', type: 'number', half: true, help: 'Charged once a year on the renewal date. Empty: no renewal fee.' },
      REASON_FIELD,
    ],
    initial: {
      effectiveFrom: today(),
      priceStatus: t.priceStatus,
      monthlyPrice: s(t.monthlyPrice),
      annualPrice: s(t.annualPrice),
      includedStorageGb: s(t.includedStorageGb),
      storageStatus: t.storageStatus,
      includedSchemes: s(t.includedSchemes),
      extraSchemePrice: s(t.extraSchemePrice),
      annualRenewalFee: s(t.annualRenewalFee),
    },
    submitLabel: 'Save terms',
    stepUp: { action: 'change-platform-config', detail: `Change ${name}’s commercial terms` },
    submit: (f) =>
      data.savePackageTerms(p.packageId, {
        effectiveFrom: f['effectiveFrom'],
        monthlyPrice: num(f['monthlyPrice']),
        annualPrice: num(f['annualPrice']),
        priceStatus: f['priceStatus'] as PriceStatus,
        includedStorageGb: num(f['includedStorageGb']),
        storageStatus: f['storageStatus'] as PriceStatus,
        includedSchemes: num(f['includedSchemes']),
        extraSchemePrice: num(f['extraSchemePrice']),
        annualRenewalFee: num(f['annualRenewalFee']),
        reason: f['reason'],
      }),
    success: (_r, f) => `${name}: new terms from ${f['effectiveFrom']}.`,
    failure: 'The terms weren’t saved',
  });
}

const KIND_OPTIONS: { value: AddOnKind; label: string }[] = [
  { value: 'feature', label: 'Feature module' },
  { value: 'communication', label: 'Communication' },
  { value: 'storage', label: 'Storage pack' },
];

export function addOnForm(drawer: DrawerService, data: CommercialDataSource, existing?: CommercialAddOn): void {
  const t = existing && (termsOn(existing.terms, today()) ?? existing.terms[0]);
  const s = (n: number | null | undefined) => (n == null ? '' : String(n));
  openForm(drawer, {
    eyebrow: 'Humo catalogue · Add-ons',
    title: existing ? existing.name : 'New add-on',
    intro: existing
      ? 'A price change takes effect from its date as a new version. Customers who already have it keep their agreed price.'
      : 'Add-ons are catalogue data: no code change is needed. They switch on features the app already has.',
    fields: [
      ...(existing ? [] : [{ key: 'id', label: 'Id (permanent)', type: 'text' as const, required: true, placeholder: 'e.g. sms-bundle', half: true }]),
      { key: 'kind', label: 'Kind', type: 'select', required: true, half: true, options: KIND_OPTIONS },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea', required: true },
      { key: 'features', label: 'Features it switches on', type: 'checks', options: FEATURES.filter((f) => !f.baseline).map((f) => ({ value: f.key, label: f.label })), requiredIf: (f) => f['kind'] !== 'storage' },
      { key: 'storageGb', label: 'GB per pack', type: 'number', half: true, showIf: (f) => f['kind'] === 'storage', requiredIf: (f) => f['kind'] === 'storage' },
      { key: 'allowQuantity', label: 'Can be bought more than once', type: 'select', half: true, required: true, options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }] },
      { key: 'effectiveFrom', label: 'Price effective from', type: 'date', required: true, half: true },
      { key: 'priceStatus', label: 'Price status', type: 'select', required: true, half: true, options: PRICE_STATUS_OPTIONS },
      { key: 'price', label: 'Price (rand, excl. tax)', type: 'number', half: true, help: 'Leave empty while awaiting configuration.' },
      { key: 'frequency', label: 'Billed', type: 'select', required: true, half: true, options: [{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annually' }] },
      { key: 'allowanceIncluded', label: 'Usage allowance', type: 'number', half: true, help: 'Optional, e.g. 500 messages a month.' },
      { key: 'allowanceUnit', label: 'Allowance unit', type: 'text', half: true, placeholder: 'e.g. WhatsApp messages' },
      { key: 'status', label: 'Status', type: 'select', required: true, half: true, options: [{ value: 'active', label: 'Active' }, { value: 'draft', label: 'Draft' }, { value: 'retired', label: 'Retired' }] },
      { key: 'retiresOn', label: 'Retires on', type: 'date', half: true },
      REASON_FIELD,
    ],
    initial: {
      kind: existing?.kind ?? 'feature',
      name: existing?.name ?? '',
      description: existing?.description ?? '',
      features: existing?.features.join(',') ?? '',
      storageGb: s(existing?.storageGb),
      allowQuantity: existing?.allowQuantity ? 'yes' : 'no',
      effectiveFrom: today(),
      priceStatus: t?.priceStatus ?? 'awaiting',
      price: s(t?.price),
      frequency: t?.frequency === 'annual' ? 'annual' : 'monthly',
      allowanceIncluded: s(t?.usageAllowance?.included),
      allowanceUnit: t?.usageAllowance?.unit ?? '',
      status: existing?.status ?? 'active',
      retiresOn: existing?.retiresOn ?? '',
    },
    submitLabel: existing ? 'Save' : 'Create add-on',
    stepUp: { action: 'change-platform-config', detail: existing ? `Change the ${existing.name} add-on` : 'Create a catalogue add-on' },
    submit: (f: FormValues) =>
      data.saveAddOn(
        {
          id: existing?.id ?? f['id'].trim(),
          name: f['name'],
          description: f['description'],
          kind: f['kind'] as AddOnKind,
          features: (f['kind'] === 'storage' ? ['storage-extra'] : f['features'].split(',').filter(Boolean)) as Feature[],
          storageGb: num(f['storageGb']) ?? undefined,
          allowQuantity: f['allowQuantity'] === 'yes',
          status: f['status'] as CommercialAddOn['status'],
          retiresOn: f['retiresOn'] || undefined,
          effectiveFrom: f['effectiveFrom'],
          price: num(f['price']),
          frequency: f['frequency'] as 'monthly' | 'annual',
          priceStatus: f['priceStatus'] as PriceStatus,
          usageAllowance: f['allowanceIncluded'] ? { unit: f['allowanceUnit'] || 'units', included: num(f['allowanceIncluded']) ?? 0 } : undefined,
          reason: f['reason'],
        },
        !existing,
      ),
    success: (_r, f) => `${f['name']} saved.`,
    failure: 'The add-on wasn’t saved',
  });
}

export function settingsForm(drawer: DrawerService, data: CommercialDataSource, settings: CommercialSettings, managers: { value: string; label: string }[]): void {
  const { version, ...current } = settings;
  openForm(drawer, {
    eyebrow: 'Humo catalogue',
    title: 'Commercial settings',
    intro: 'The proration policy and the VAT position are business decisions awaiting approval (docs/23). Humo charges VAT only when it is registered.',
    fields: [
      { key: 'warn', label: 'First storage warning at (%)', type: 'number', required: true, half: true },
      { key: 'crit', label: 'Second warning at (%)', type: 'number', required: true, half: true },
      { key: 'proration', label: 'Mid-cycle changes', type: 'select', required: true, options: (Object.keys(PRORATION_LABELS) as ProrationPolicy[]).map((p) => ({ value: p, label: PRORATION_LABELS[p] })) },
      { key: 'prorationAwaitingApproval', label: 'Proration policy', type: 'select', required: true, half: true, options: [{ value: 'yes', label: 'Awaiting business approval' }, { value: 'no', label: 'Approved' }] },
      { key: 'paymentTermsDays', label: 'Payment terms (days)', type: 'number', required: true, half: true },
      { key: 'legalName', label: 'Humo legal name on invoices', type: 'text', required: true },
      { key: 'registrationNumber', label: 'Company registration number', type: 'text', half: true },
      { key: 'vatRegistered', label: 'VAT', type: 'select', required: true, half: true, options: [{ value: 'no', label: 'Not registered: no VAT charged' }, { value: 'yes', label: 'Registered: charge VAT' }] },
      { key: 'vatNumber', label: 'VAT number', type: 'text', half: true, showIf: (f) => f['vatRegistered'] === 'yes', requiredIf: (f) => f['vatRegistered'] === 'yes' },
      { key: 'ratePercent', label: 'VAT rate (%)', type: 'number', required: true, half: true },
      { key: 'designatedAccountManagerId', label: 'Designated account manager (new customers)', type: 'select', required: true, options: managers },
      REASON_FIELD,
    ],
    initial: {
      warn: String(current.storageThresholds[0]),
      crit: String(current.storageThresholds[1]),
      proration: current.proration,
      prorationAwaitingApproval: current.prorationAwaitingApproval ? 'yes' : 'no',
      paymentTermsDays: String(current.paymentTermsDays),
      legalName: current.tax.legalName,
      registrationNumber: current.tax.registrationNumber ?? '',
      vatRegistered: current.tax.vatRegistered ? 'yes' : 'no',
      vatNumber: current.tax.vatNumber ?? '',
      ratePercent: String(current.tax.ratePercent),
      designatedAccountManagerId: current.designatedAccountManagerId,
    },
    submitLabel: 'Save settings',
    stepUp: { action: 'change-platform-config', detail: 'Change Humo’s commercial settings' },
    submit: (f) =>
      data.saveSettings(
        {
          storageThresholds: [num(f['warn']) ?? 0, num(f['crit']) ?? 0],
          proration: f['proration'] as ProrationPolicy,
          prorationAwaitingApproval: f['prorationAwaitingApproval'] === 'yes',
          paymentTermsDays: num(f['paymentTermsDays']) ?? 0,
          tax: {
            legalName: f['legalName'],
            registrationNumber: f['registrationNumber'] || undefined,
            vatRegistered: f['vatRegistered'] === 'yes',
            vatNumber: f['vatRegistered'] === 'yes' ? f['vatNumber'] : undefined,
            ratePercent: num(f['ratePercent']) ?? 0,
          },
          designatedAccountManagerId: f['designatedAccountManagerId'],
        },
        f['reason'],
        version,
      ),
    success: () => 'Commercial settings saved.',
    failure: 'The settings weren’t saved',
  });
}
