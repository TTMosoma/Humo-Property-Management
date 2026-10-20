import { saDate } from './dates';
import { AddOnId, Feature, PackageId } from './entitlement';

/**
 * Humo's commercial layer (docs/23): what Humo charges its customers.
 *
 *   Catalogue (effective-dated terms)   ← what Humo offers, at what list price
 *   Agreement (per customer, dated lines) ← what this customer agreed to pay
 *   Invoice (snapshot)                    ← what was charged for a period
 *
 * The catalogue and the agreement are separate on purpose: a catalogue price
 * change never reaches an existing agreement unless someone authorised changes
 * that agreement, and an invoice never looks the price up again.
 *
 * Entitlements still come from `resolveEntitlements()`: the agreement only
 * decides which package and add-ons are in force on a date.
 *
 * Everything here is pure, so the .NET backend can mirror it rule for rule.
 */

/** A price nobody has decided yet stays `awaiting`; example values are `proposed` until the business approves them. */
export type PriceStatus = 'awaiting' | 'proposed' | 'approved';
export type BillingFrequency = 'monthly' | 'annual' | 'once-off';
export type CatalogueStatus = 'draft' | 'active' | 'retired';

export const PRICE_STATUS_LABELS: Record<PriceStatus, string> = {
  awaiting: 'Awaiting configuration',
  proposed: 'Proposed, not approved',
  approved: 'Approved',
};

/** A package's commercial terms from a date. A change is a new version; history is kept. */
export interface PackageTerms {
  version: number;
  /** yyyy-mm-dd. */
  effectiveFrom: string;
  /** Rand per month, excluding tax. Null until decided. */
  monthlyPrice: number | null;
  annualPrice: number | null;
  priceStatus: PriceStatus;
  /** Null: negotiated per customer (Enterprise). */
  includedStorageGb: number | null;
  storageStatus: PriceStatus;
  /** Schemes the price covers; null when the package isn't priced by portfolio size. */
  includedSchemes: number | null;
  /** Rand per month for each block of extra schemes beyond `includedSchemes`. Applies to catalogue-priced agreements only. */
  extraSchemePrice: number | null;
  /** Schemes per block, e.g. R150 per 10 extra schemes (a part block counts as a block). Omitted or 1: priced per scheme. */
  extraSchemeBlock?: number | null;
  /** Charged once a year on the renewal date, on top of the recurring price. Null: no renewal fee. */
  annualRenewalFee: number | null;
  /** SMS a month that come with the package (20, 100, 500). Unused SMS don't carry over. */
  includedSms?: number | null;
  changedBy: string;
  changedAt: string;
  reason: string;
}

export interface CommercialPackage {
  /** The entitlement package (`PACKAGES`): names and features stay there, so there's one catalogue of packages. */
  packageId: PackageId;
  billingFrequencies: ('monthly' | 'annual')[];
  status: CatalogueStatus;
  /** yyyy-mm-dd: no new agreements from this date. */
  retiresOn?: string;
  /** Newest first. */
  terms: PackageTerms[];
}

export type AddOnKind = 'feature' | 'storage' | 'communication';

export interface AddOnTerms {
  version: number;
  effectiveFrom: string;
  price: number | null;
  frequency: BillingFrequency;
  priceStatus: PriceStatus;
  /** E.g. 1 000 WhatsApp messages a month; usage beyond it is a usage charge, not part of the recurring total. */
  usageAllowance?: { unit: string; included: number };
  changedBy: string;
  changedAt: string;
  reason: string;
}

/**
 * An add-on as catalogue data: a new one needs no code change, only features
 * the app already knows (feature keys stay in code, because the app gates on them).
 */
export interface CommercialAddOn {
  id: AddOnId;
  name: string;
  description: string;
  kind: AddOnKind;
  features: Feature[];
  /** Storage packs: gigabytes per unit bought. */
  storageGb?: number;
  /** Storage packs can be bought more than once. */
  allowQuantity: boolean;
  status: CatalogueStatus;
  retiresOn?: string;
  terms: AddOnTerms[];
}

export type ProrationPolicy = 'next-cycle' | 'daily';

export const PRORATION_LABELS: Record<ProrationPolicy, string> = {
  'next-cycle': 'Next billing cycle: a change is charged in full from the first invoice after it takes effect; nothing is pro-rated',
  daily: 'Daily pro-rata: the invoice charges each line for the days it was in force',
};

export interface TaxConfig {
  /** Humo's own legal details, printed on its invoices. */
  legalName: string;
  registrationNumber?: string;
  /** Humo charges VAT only when this is on. */
  vatRegistered: boolean;
  vatNumber?: string;
  /** Percent, e.g. 15. */
  ratePercent: number;
}

export interface CommercialSettings {
  version: number;
  /** Storage warnings, percent of the allowance used. */
  storageThresholds: [number, number];
  proration: ProrationPolicy;
  /** True until the business approves the policy above. */
  prorationAwaitingApproval: boolean;
  tax: TaxConfig;
  /** The Humo Account Manager new customers go to by default (a staff identity id). */
  designatedAccountManagerId: string;
  /** Days between invoice and due date. */
  paymentTermsDays: number;
  /** A discount above this share of the recurring charges needs a second approver (Platform.Discounts.Approve). Default 20. */
  discountApprovalPercent?: number;
}

export interface CommercialCatalogue {
  packages: CommercialPackage[];
  addOns: CommercialAddOn[];
  settings: CommercialSettings;
}

// ---------------------------------------------------------------- The customer's agreement

export type PriceSource = 'catalogue' | 'negotiated' | 'included';

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  catalogue: 'Catalogue price when agreed',
  negotiated: 'Agreed price',
  included: 'Included in the agreed package price',
};

/** A dated line of the agreement. A future `from` is a scheduled change. */
interface DatedLine {
  id: string;
  /** yyyy-mm-dd, inclusive. */
  from: string;
  /** yyyy-mm-dd, exclusive. */
  until?: string;
}

export interface PackageLine extends DatedLine {
  packageId: PackageId;
  /** Rand per month, excluding tax. Null: awaiting a price. */
  monthlyPrice: number | null;
  priceSource: PriceSource;
  /** The catalogue terms the price came from, if it did. */
  catalogueVersion?: number;
}

export interface AddOnLine extends DatedLine {
  addOnId: AddOnId;
  quantity: number;
  /** Rand per unit per `frequency`. Null: included or awaiting a price. */
  unitPrice: number | null;
  frequency: BillingFrequency;
  priceSource: PriceSource;
  catalogueVersion?: number;
}

export type AdjustmentKind = 'discount' | 'credit' | 'once-off-fee';

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  discount: 'Recurring discount',
  credit: 'Credit',
  'once-off-fee': 'Once-off fee',
};

export interface Adjustment extends DatedLine {
  kind: AdjustmentKind;
  label: string;
  /** Rand, excluding tax. A discount may be a percentage instead. */
  amount: number;
  percent?: number;
  reason: string;
  by: string;
  at: string;
  /** Credits and once-off fees: the invoice that used it. */
  invoicedOn?: string;
}

export type BillingPreference = 'card-recurring' | 'instant-eft' | 'manual-eft';

export const BILLING_PREFERENCE_LABELS: Record<BillingPreference, string> = {
  'card-recurring': 'Recurring card payment',
  'instant-eft': 'Online bank payment (Instant EFT)',
  'manual-eft': 'Manual EFT',
};

export const BILLING_PREFERENCE_HELP: Record<BillingPreference, string> = {
  'card-recurring': 'The intended default: the payment provider charges the card on file each cycle, under the customer’s mandate. Humo never stores card numbers.',
  'instant-eft': 'The customer pays each invoice online through the payment provider’s bank payment page.',
  'manual-eft': 'Humo sends the invoice and reminders; the customer pays by EFT. An invoice is paid only once the payment is reconciled with Humo’s bank account.',
};

/** A temporary storage allowance granted outside the agreement, e.g. while a pack is being agreed. Always audited. */
export interface StorageException {
  id: string;
  extraGb: number;
  until: string;
  reason: string;
  by: string;
  at: string;
}

/** Who did what to the agreement, and on whose authority. */
export interface AgreementEvent {
  at: string;
  byId: string;
  by: string;
  action: string;
  reason: string;
  effectiveFrom?: string;
  /** Who approved it. D11: an Account Manager's change to their own customer needs no separate approval. */
  approval: string;
}

export interface CommercialAgreement {
  organisationId: string;
  /** Concurrency token. */
  version: number;
  cycle: 'monthly' | 'annual';
  packages: PackageLine[];
  addOns: AddOnLine[];
  adjustments: Adjustment[];
  storageExceptions: StorageException[];
  /** Negotiated storage (Enterprise), replacing the package allowance. */
  negotiatedStorageGb?: number;
  /**
   * The annual renewal: the next renewal date, and the fee charged once on the
   * invoice whose period includes it. Not part of the recurring monthly total.
   */
  renewal: { on: string; fee: number | null; priceSource: PriceSource };
  billing: {
    preference: BillingPreference;
    billingEmail: string;
    /** yyyy-mm-dd. */
    nextBillingDate: string;
    /** Card or debit mandate at the payment provider; Humo keeps only its reference. */
    mandate: { status: 'none' | 'pending' | 'active'; reference?: string };
  };
  history: AgreementEvent[];
  /** Changes waiting for a second approver (a discount above the threshold). Not in force until approved. */
  pendingApprovals?: PendingApproval[];
}

/** A change someone asked for that needs another person's approval before it applies. */
export interface PendingApproval {
  id: string;
  change: AgreementChange;
  /** How the change reads in the history and the audit log. */
  describe: string;
  requestedById: string;
  requestedBy: string;
  at: string;
  /** Why it needs approval, e.g. "35% of the recurring charges (more than 20%)". */
  why: string;
}

export const DEFAULT_DISCOUNT_APPROVAL_PERCENT = 20;

/**
 * Does this change need a second approver? A recurring discount above the threshold (as a percentage,
 * or as an amount against the recurring charges before discounts on its start date) does.
 */
export function approvalNeeded(a: CommercialAgreement, c: AgreementChange, ctx: ChargeContext): string | null {
  if (c.type !== 'adjustment' || c.kind !== 'discount') return null;
  const limit = ctx.catalogue.settings.discountApprovalPercent ?? DEFAULT_DISCOUNT_APPROVAL_PERCENT;
  if (c.percent != null) return c.percent > limit ? `${c.percent}% off (more than ${limit}%)` : null;
  const base = chargesOn(a, c.from, ctx).recurring.filter((l) => l.kind !== 'discount').reduce((n, l) => n + (l.amount ?? 0), 0);
  const share = base > 0 ? (c.amount / base) * 100 : 100;
  return share > limit ? `${Math.round(share)}% of the recurring charges (more than ${limit}%)` : null;
}

/** A change an authorised Humo person makes to an agreement. */
export type AgreementChange =
  | { type: 'package'; packageId: PackageId; effectiveFrom: string; /** Omitted: the catalogue price in force then. */ monthlyPrice?: number | null; reason: string }
  | { type: 'add-on'; addOnId: AddOnId; quantity: number; effectiveFrom: string; unitPrice?: number | null; reason: string }
  | { type: 'remove-add-on'; addOnId: AddOnId; effectiveFrom: string; reason: string }
  | { type: 'cancel-scheduled'; lineId: string; reason: string }
  | { type: 'adjustment'; kind: AdjustmentKind; label: string; amount: number; percent?: number; from: string; until?: string; reason: string }
  | { type: 'billing-preference'; preference: BillingPreference; billingEmail: string; reason: string }
  | { type: 'storage-exception'; extraGb: number; until: string; reason: string }
  | { type: 'renewal'; on: string; /** Null: no renewal fee. */ fee: number | null; reason: string };

// ---------------------------------------------------------------- Lookups

export const isoDay = (d: Date | string): string => (typeof d === 'string' ? d.slice(0, 10) : saDate(d));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The terms in force on a date: the newest whose `effectiveFrom` is on or before it. */
export function termsOn<T extends { effectiveFrom: string }>(terms: T[], on: string): T | undefined {
  return terms.filter((t) => t.effectiveFrom <= on).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

export function inForce<T extends DatedLine>(lines: T[], on: string): T[] {
  return lines.filter((l) => l.from <= on && (!l.until || l.until > on));
}

/** Lines that start after the date: scheduled changes. */
export function scheduled<T extends DatedLine>(lines: T[], on: string): T[] {
  return lines.filter((l) => l.from > on).sort((a, b) => a.from.localeCompare(b.from));
}

export function packageOn(a: CommercialAgreement, on: string): PackageLine | undefined {
  return inForce(a.packages, on).sort((x, y) => y.from.localeCompare(x.from))[0];
}

export function addOnDef(cat: CommercialCatalogue, id: AddOnId): CommercialAddOn | undefined {
  return cat.addOns.find((x) => x.id === id);
}

export function packageDef(cat: CommercialCatalogue, id: PackageId): CommercialPackage | undefined {
  return cat.packages.find((x) => x.packageId === id);
}

// ---------------------------------------------------------------- Charges

export interface ChargeLine {
  kind: 'package' | 'extra-schemes' | 'add-on' | 'discount' | 'credit' | 'once-off-fee' | 'renewal-fee';
  label: string;
  detail: string;
  quantity: number;
  unitPrice: number | null;
  frequency: BillingFrequency;
  /** Per month for recurring lines (annual ÷ 12); the full amount for once-off lines. Null: no price yet. */
  amount: number | null;
  priceSource: PriceSource;
}

export interface ChargeSummary {
  on: string;
  cycle: CommercialAgreement['cycle'];
  recurring: ChargeLine[];
  /** Recurring, per month, excluding tax and excluding lines with no price yet. */
  recurringMonthly: number;
  /** Lines in the recurring total that have no price yet. */
  awaitingPrice: number;
  /** Next invoice only. */
  onceOff: ChargeLine[];
  credits: ChargeLine[];
  /** Usage-based charges aren't in the recurring total. */
  usage: { label: string; note: string }[];
  /** The next annual renewal and its fee (charged once, on the invoice covering that date). */
  renewal: { on: string; fee: number | null; priceSource: PriceSource };
  tax: { registered: boolean; ratePercent: number; amount: number };
  /** Recurring per month plus tax, if Humo is VAT registered. */
  recurringWithTax: number;
}

export interface ChargeContext {
  catalogue: CommercialCatalogue;
  /** Schemes the customer manages (for portfolio pricing). */
  schemes: number;
  packageName: (id: PackageId) => string;
}

const monthly = (price: number, frequency: BillingFrequency) => (frequency === 'annual' ? price / 12 : price);

/** What the agreement charges on a date: recurring lines, next-invoice once-offs and credits, usage and tax, kept apart. */
export function chargesOn(a: CommercialAgreement, on: string, ctx: ChargeContext): ChargeSummary {
  const recurring: ChargeLine[] = [];
  const pkg = packageOn(a, on);
  if (pkg) {
    recurring.push({
      kind: 'package',
      label: ctx.packageName(pkg.packageId),
      detail: PRICE_SOURCE_LABELS[pkg.priceSource],
      quantity: 1,
      unitPrice: pkg.monthlyPrice,
      frequency: 'monthly',
      amount: pkg.monthlyPrice,
      priceSource: pkg.priceSource,
    });
    const terms = termsOn(packageDef(ctx.catalogue, pkg.packageId)?.terms ?? [], on);
    const extra = terms?.includedSchemes != null ? Math.max(0, ctx.schemes - terms.includedSchemes) : 0;
    if (pkg.priceSource === 'catalogue' && extra > 0 && terms?.extraSchemePrice != null) {
      const block = Math.max(1, terms.extraSchemeBlock ?? 1);
      const blocks = Math.ceil(extra / block);
      recurring.push({
        kind: 'extra-schemes',
        label: 'Additional schemes',
        detail: block > 1 ? `${extra} beyond the ${terms.includedSchemes} included: ${blocks} × ${block}` : `${extra} beyond the ${terms.includedSchemes} included`,
        quantity: blocks,
        unitPrice: terms.extraSchemePrice,
        frequency: 'monthly',
        amount: round2(blocks * terms.extraSchemePrice),
        priceSource: 'catalogue',
      });
    }
  }
  const usage: ChargeSummary['usage'] = [];
  for (const l of inForce(a.addOns, on)) {
    const def = addOnDef(ctx.catalogue, l.addOnId);
    const name = def?.name ?? l.addOnId;
    recurring.push({
      kind: 'add-on',
      label: l.quantity > 1 ? `${name} × ${l.quantity}` : name,
      detail: PRICE_SOURCE_LABELS[l.priceSource],
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      frequency: l.frequency,
      amount: l.priceSource === 'included' ? 0 : l.unitPrice === null ? null : round2(monthly(l.unitPrice, l.frequency) * l.quantity),
      priceSource: l.priceSource,
    });
    const allowance = termsOn(def?.terms ?? [], on)?.usageAllowance;
    if (allowance) usage.push({ label: name, note: `${allowance.included.toLocaleString('en-ZA')} ${allowance.unit} a month included; use beyond it is charged by usage, not in the recurring total.` });
  }
  const subtotal = recurring.reduce((n, l) => n + (l.amount ?? 0), 0);
  for (const d of inForce(a.adjustments, on).filter((x) => x.kind === 'discount')) {
    const amount = d.percent != null ? round2((subtotal * d.percent) / 100) : d.amount;
    recurring.push({ kind: 'discount', label: d.label, detail: d.percent != null ? `${d.percent}% off` : 'Fixed discount', quantity: 1, unitPrice: -amount, frequency: 'monthly', amount: -amount, priceSource: 'negotiated' });
  }
  const pending = (k: AdjustmentKind) =>
    a.adjustments
      .filter((x) => x.kind === k && !x.invoicedOn && x.from <= on)
      .map<ChargeLine>((x) => ({ kind: k, label: x.label, detail: x.reason, quantity: 1, unitPrice: k === 'credit' ? -x.amount : x.amount, frequency: 'once-off', amount: k === 'credit' ? -x.amount : x.amount, priceSource: 'negotiated' }));
  const recurringMonthly = round2(recurring.reduce((n, l) => n + (l.amount ?? 0), 0));
  const tax = ctx.catalogue.settings.tax;
  const taxAmount = tax.vatRegistered ? round2((recurringMonthly * tax.ratePercent) / 100) : 0;
  return {
    on,
    cycle: a.cycle,
    recurring,
    recurringMonthly,
    awaitingPrice: recurring.filter((l) => l.amount === null).length,
    onceOff: pending('once-off-fee'),
    credits: pending('credit'),
    usage,
    renewal: a.renewal,
    tax: { registered: tax.vatRegistered, ratePercent: tax.ratePercent, amount: taxAmount },
    recurringWithTax: round2(recurringMonthly + taxAmount),
  };
}

// ---------------------------------------------------------------- Changes

export interface ChangeActor {
  id: string;
  name: string;
  /** How the change was authorised, for the history. */
  approval: string;
}

let lineSeq = 0;
const lineId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++lineSeq).toString(36)}`;

/** Server-side checks for a change; field → message, or null. */
export function checkAgreementChange(a: CommercialAgreement, c: AgreementChange, cat: CommercialCatalogue, today: string): Record<string, string> | null {
  const e: Record<string, string> = {};
  const validDay = (d: string | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (c.reason.trim().length < 8) e['reason'] = 'Say why, in a few words. It goes in the audit log.';
  switch (c.type) {
    case 'package': {
      const def = packageDef(cat, c.packageId);
      if (!validDay(c.effectiveFrom) || c.effectiveFrom < today) e['effectiveFrom'] = 'Choose today or a later date.';
      else if (packageOn(a, c.effectiveFrom)?.packageId === c.packageId) e['packageId'] = 'They’re already on this package then.';
      if (!def || def.status !== 'active' || (def.retiresOn && def.retiresOn <= c.effectiveFrom)) e['packageId'] = 'This package isn’t available.';
      const price = c.monthlyPrice === undefined ? termsOn(def?.terms ?? [], c.effectiveFrom)?.monthlyPrice ?? null : c.monthlyPrice;
      if (price === null) e['monthlyPrice'] = 'This package has no catalogue price yet. Enter the price agreed with the customer.';
      else if (price < 0) e['monthlyPrice'] = 'A price can’t be negative.';
      break;
    }
    case 'add-on': {
      const def = addOnDef(cat, c.addOnId);
      if (!validDay(c.effectiveFrom) || c.effectiveFrom < today) e['effectiveFrom'] = 'Choose today or a later date.';
      if (!def || def.status !== 'active' || (def.retiresOn && def.retiresOn <= c.effectiveFrom)) e['addOnId'] = 'This add-on isn’t available.';
      else if (!def.allowQuantity && inForce(a.addOns, c.effectiveFrom).some((l) => l.addOnId === c.addOnId)) e['addOnId'] = 'They already have this add-on then.';
      else if (scheduled(a.addOns, today).some((l) => l.addOnId === c.addOnId && !def.allowQuantity)) e['addOnId'] = 'This add-on is already scheduled. Cancel that change first.';
      if (!Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > (def?.allowQuantity ? 20 : 1)) e['quantity'] = def?.allowQuantity ? 'Between 1 and 20.' : 'This add-on is bought once.';
      const price = c.unitPrice === undefined ? termsOn(def?.terms ?? [], c.effectiveFrom)?.price ?? null : c.unitPrice;
      if (def && price === null) e['unitPrice'] = 'This add-on has no catalogue price yet. Enter the price agreed with the customer.';
      else if (price !== null && price < 0) e['unitPrice'] = 'A price can’t be negative.';
      break;
    }
    case 'remove-add-on':
      if (!validDay(c.effectiveFrom) || c.effectiveFrom < today) e['effectiveFrom'] = 'Choose today or a later date.';
      else if (!inForce(a.addOns, c.effectiveFrom).some((l) => l.addOnId === c.addOnId)) e['addOnId'] = 'They won’t have this add-on then.';
      break;
    case 'cancel-scheduled': {
      const line = [...a.packages, ...a.addOns].find((l) => l.id === c.lineId);
      if (!line || line.from <= today) e['lineId'] = 'Only a change that hasn’t taken effect can be cancelled.';
      break;
    }
    case 'adjustment':
      if (!c.label.trim()) e['label'] = 'Name it as it should appear on the invoice.';
      if (!validDay(c.from)) e['from'] = 'Choose a date.';
      if (c.until && (!validDay(c.until) || c.until <= c.from)) e['until'] = 'After the start date.';
      if (c.percent != null ? !(c.percent > 0 && c.percent <= 100) : !(c.amount > 0)) e['amount'] = 'Enter an amount above zero (or a percentage up to 100).';
      if (c.kind !== 'discount' && c.percent != null) e['amount'] = 'Only a discount can be a percentage.';
      break;
    case 'billing-preference':
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.billingEmail)) e['billingEmail'] = 'Where should invoices go? A valid email address.';
      if (c.preference === a.billing.preference && c.billingEmail === a.billing.billingEmail) e['preference'] = 'Nothing has changed.';
      break;
    case 'storage-exception':
      if (!(c.extraGb > 0 && c.extraGb <= 500)) e['extraGb'] = 'Between 1 and 500 GB.';
      if (!validDay(c.until) || c.until <= today) e['until'] = 'A date after today: exceptions are temporary.';
      break;
    case 'renewal':
      if (!validDay(c.on) || c.on <= today) e['on'] = 'The next renewal date, after today.';
      if (c.fee !== null && !(c.fee >= 0)) e['fee'] = 'Zero or more, or leave it empty for no renewal fee.';
      if (c.fee === a.renewal.fee && c.on === a.renewal.on) e['fee'] = 'Nothing has changed.';
      break;
  }
  return Object.keys(e).length ? e : null;
}

/** The agreement after a change (the caller has checked it). Pure: used for the preview and for saving. */
export function applyAgreementChange(a: CommercialAgreement, c: AgreementChange, cat: CommercialCatalogue, actor: ChangeActor, now: Date, describe: string): CommercialAgreement {
  const at = now.toISOString();
  const next: CommercialAgreement = structuredClone(a);
  let effectiveFrom: string | undefined;
  switch (c.type) {
    case 'package': {
      effectiveFrom = c.effectiveFrom;
      const terms = termsOn(packageDef(cat, c.packageId)?.terms ?? [], c.effectiveFrom);
      const fromCatalogue = c.monthlyPrice === undefined;
      // A later package change that was scheduled is replaced by this one.
      next.packages = next.packages.filter((l) => l.from <= c.effectiveFrom || l.from <= isoDay(now));
      for (const l of inForce(next.packages, c.effectiveFrom)) l.until = c.effectiveFrom;
      next.packages.push({
        id: lineId('pk'),
        packageId: c.packageId,
        from: c.effectiveFrom,
        monthlyPrice: fromCatalogue ? (terms?.monthlyPrice ?? null) : (c.monthlyPrice ?? null),
        priceSource: fromCatalogue ? 'catalogue' : 'negotiated',
        catalogueVersion: fromCatalogue ? terms?.version : undefined,
      });
      // A package at catalogue price brings its catalogue renewal fee; an agreed fee stays until someone changes it.
      if (fromCatalogue && terms?.annualRenewalFee != null && (next.renewal.fee === null || next.renewal.priceSource !== 'negotiated')) next.renewal = { ...next.renewal, fee: terms.annualRenewalFee, priceSource: 'catalogue' };
      break;
    }
    case 'add-on': {
      effectiveFrom = c.effectiveFrom;
      const def = addOnDef(cat, c.addOnId);
      const terms = termsOn(def?.terms ?? [], c.effectiveFrom);
      const fromCatalogue = c.unitPrice === undefined;
      next.addOns.push({
        id: lineId('ao'),
        addOnId: c.addOnId,
        quantity: c.quantity,
        from: c.effectiveFrom,
        unitPrice: fromCatalogue ? (terms?.price ?? null) : (c.unitPrice ?? null),
        frequency: terms?.frequency ?? 'monthly',
        priceSource: fromCatalogue ? 'catalogue' : 'negotiated',
        catalogueVersion: fromCatalogue ? terms?.version : undefined,
      });
      break;
    }
    case 'remove-add-on':
      effectiveFrom = c.effectiveFrom;
      for (const l of inForce(next.addOns, c.effectiveFrom).filter((x) => x.addOnId === c.addOnId)) l.until = c.effectiveFrom;
      break;
    case 'cancel-scheduled': {
      const line = [...next.packages, ...next.addOns].find((l) => l.id === c.lineId)!;
      next.packages = next.packages.filter((l) => l.id !== c.lineId);
      next.addOns = next.addOns.filter((l) => l.id !== c.lineId);
      // The package it would have replaced carries on.
      if ('packageId' in line) for (const l of next.packages.filter((x) => x.until === line.from)) delete l.until;
      break;
    }
    case 'adjustment':
      effectiveFrom = c.from;
      next.adjustments.push({ id: lineId('adj'), kind: c.kind, label: c.label.trim(), amount: c.amount, percent: c.percent, from: c.from, until: c.until, reason: c.reason.trim(), by: actor.name, at });
      break;
    case 'billing-preference':
      next.billing = { ...next.billing, preference: c.preference, billingEmail: c.billingEmail.trim(), mandate: c.preference === 'card-recurring' ? next.billing.mandate : { status: 'none' } };
      break;
    case 'renewal':
      effectiveFrom = c.on;
      next.renewal = { on: c.on, fee: c.fee, priceSource: 'negotiated' };
      break;
    case 'storage-exception':
      next.storageExceptions.push({ id: lineId('sx'), extraGb: c.extraGb, until: c.until, reason: c.reason.trim(), by: actor.name, at });
      break;
  }
  next.version = a.version + 1;
  next.history = [{ at, byId: actor.id, by: actor.name, action: describe, reason: c.reason.trim(), effectiveFrom, approval: actor.approval }, ...a.history];
  return next;
}

/** Before and after, on the date the change takes effect, for the person to confirm. */
export interface ChangePreview {
  effectiveFrom: string;
  before: ChargeSummary;
  after: ChargeSummary;
  /** Per month, excluding tax. */
  difference: number;
  /** The first invoice that includes the change, under the proration policy. */
  firstInvoiceOn: string;
  policy: ProrationPolicy;
  errors: Record<string, string> | null;
  /** Set when the change needs a second approver: it waits until approved. */
  approvalNeeded?: string | null;
}

export function previewAgreementChange(a: CommercialAgreement, c: AgreementChange, ctx: ChargeContext, today: string): ChangePreview {
  const effectiveFrom = 'effectiveFrom' in c ? c.effectiveFrom : c.type === 'adjustment' ? c.from : today;
  const errors = checkAgreementChange(a, c, ctx.catalogue, today);
  // A missing reason doesn't stop the preview: the person sees the effect while they write it.
  const blocking = !!errors && Object.keys(errors).some((k) => k !== 'reason');
  const after = blocking ? a : applyAgreementChange(a, c, ctx.catalogue, { id: '', name: '', approval: '' }, new Date(), '');
  const before = chargesOn(a, effectiveFrom, ctx);
  const afterCharges = chargesOn(after, effectiveFrom, ctx);
  const policy = ctx.catalogue.settings.proration;
  const firstInvoiceOn = policy === 'daily' || effectiveFrom <= a.billing.nextBillingDate ? a.billing.nextBillingDate : nextCycleOn(a.billing.nextBillingDate, effectiveFrom, a.cycle);
  return { effectiveFrom, before, after: afterCharges, difference: round2(afterCharges.recurringMonthly - before.recurringMonthly), firstInvoiceOn, policy, errors, approvalNeeded: approvalNeeded(a, c, ctx) };
}

/** The first billing date on or after `on`, stepping from a known billing date. */
export function nextCycleOn(billingDate: string, on: string, cycle: CommercialAgreement['cycle']): string {
  const d = new Date(`${billingDate}T00:00:00`);
  while (isoDay(d) < on) d.setMonth(d.getMonth() + (cycle === 'annual' ? 12 : 1));
  return isoDay(d);
}

// ---------------------------------------------------------------- Storage

export const GB = 1024 ** 3;

/** What counts toward a customer's quota. Infrastructure backups, logs and Humo's own files don't. */
export const STORAGE_COUNTS = ['Documents uploaded by the agency, its owners and residents', 'Photos and other images (maintenance, inspections, profiles)', 'Files Humo generates for the customer to send or keep (statements, letters, packs)'];
export const STORAGE_EXCLUDES = ['Backups and disaster-recovery copies (Humo’s responsibility)', 'Audit logs and system records', 'Humo’s own templates and assets'];

export interface StorageMeasurement {
  organisationId: string;
  measuredAt: string;
  /** `demo`: a simulated figure. Only `measured` comes from real storage. */
  source: 'demo' | 'measured';
  documentsBytes: number;
  imagesBytes: number;
  generatedBytes: number;
}

export type StorageState = 'ok' | 'warning' | 'critical' | 'exhausted' | 'unknown';

export interface StorageSummary {
  includedGb: number | null;
  includedStatus: PriceStatus;
  negotiated: boolean;
  purchasedGb: number;
  exceptionGb: number;
  totalGb: number | null;
  usedBytes: number;
  percent: number | null;
  state: StorageState;
  thresholds: [number, number];
  measurement: StorageMeasurement;
  /** Always false in the frontend: only the API can enforce a quota (docs/23 §5). */
  enforcedByServer: false;
}

export function storageSummary(a: CommercialAgreement, cat: CommercialCatalogue, m: StorageMeasurement, on: string): StorageSummary {
  const pkg = packageOn(a, on);
  const terms = termsOn(packageDef(cat, pkg?.packageId ?? 'essentials')?.terms ?? [], on);
  const negotiated = a.negotiatedStorageGb != null;
  const includedGb = negotiated ? a.negotiatedStorageGb! : (terms?.includedStorageGb ?? null);
  const purchasedGb = inForce(a.addOns, on).reduce((n, l) => n + (addOnDef(cat, l.addOnId)?.storageGb ?? 0) * l.quantity, 0);
  const exceptionGb = a.storageExceptions.filter((x) => x.until > on).reduce((n, x) => n + x.extraGb, 0);
  const totalGb = includedGb === null ? null : includedGb + purchasedGb + exceptionGb;
  const usedBytes = m.documentsBytes + m.imagesBytes + m.generatedBytes;
  const percent = totalGb ? Math.round((usedBytes / (totalGb * GB)) * 1000) / 10 : null;
  const [warn, crit] = cat.settings.storageThresholds;
  const state: StorageState = percent === null ? 'unknown' : percent >= 100 ? 'exhausted' : percent >= crit ? 'critical' : percent >= warn ? 'warning' : 'ok';
  return { includedGb, includedStatus: negotiated ? 'approved' : (terms?.storageStatus ?? 'awaiting'), negotiated, purchasedGb, exceptionGb, totalGb, usedBytes, percent, state, thresholds: cat.settings.storageThresholds, measurement: m, enforcedByServer: false };
}

// ---------------------------------------------------------------- Invoices and payments

export interface InvoiceLine {
  description: string;
  kind: ChargeLine['kind'];
  quantity: number;
  unitPrice: number;
  amount: number;
  priceSource: PriceSource;
}

export type InvoiceStatus = 'issued' | 'overdue' | 'paid' | 'void';

/**
 * Humo's invoice to a customer: a snapshot of the prices that applied, never
 * recalculated from the catalogue. Numbering waits for the tax decision (D10:
 * gapless numbers only where the law requires them, e.g. a VAT tax invoice).
 */
export interface HumoInvoice {
  id: string;
  /** Unique, and the reference the customer pays with. */
  reference: string;
  organisationId: string;
  periodStart: string;
  /** Exclusive. */
  periodEnd: string;
  issuedOn: string;
  dueOn: string;
  lines: InvoiceLine[];
  subtotal: number;
  tax: { registered: boolean; ratePercent: number; amount: number };
  total: number;
  /** `paid` only with a verified payment. Overdue is worked out from the due date. */
  status: 'issued' | 'paid' | 'void';
  /** Demo data, not a real invoice. */
  simulated: boolean;
}

export type PaymentStatus = 'initiated' | 'pending-verification' | 'verified' | 'failed' | 'cancelled';

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  initiated: 'Checkout started',
  'pending-verification': 'Awaiting verification',
  verified: 'Verified',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/**
 * A payment against an invoice. Separate from the customer's billing
 * preference: the preference says how they like to pay, this says what
 * happened with one payment.
 */
export interface PaymentRecord {
  id: string;
  invoiceId: string;
  organisationId: string;
  method: BillingPreference;
  status: PaymentStatus;
  amount: number;
  /** E.g. "Simulated provider". The real one is named when it's chosen. */
  provider: string;
  /** The provider's id for the payment or notification; a repeat notification with the same id changes nothing. */
  providerReference?: string;
  createdAt: string;
  verifiedAt?: string;
  verifiedBy?: string;
  verification?: 'provider-notification' | 'bank-reconciliation';
  note?: string;
  /** True for every payment in the frontend: no money moved. */
  simulated: boolean;
}

/** A payment as the customer sees it: no provider notes, references or Humo staff names. */
export interface InvoicePaymentSummary {
  status: PaymentStatus;
  method: BillingPreference;
  amount: number;
  /** When it was verified, or started. */
  on: string;
  simulated: boolean;
}

/**
 * An invoice as a document: who it's from and to, its lines and totals, how
 * to pay and what has been paid. The same view for Humo staff and for the
 * customer's own administrators (with `payments` reduced to summaries).
 */
export interface InvoiceDocument {
  invoice: Omit<HumoInvoice, 'status'> & { status: InvoiceStatus };
  from: TaxConfig;
  billTo: { organisationId: string; name: string; legalName: string; city: string; province: string; billingEmail: string };
  billingPreference: BillingPreference;
  payments: InvoicePaymentSummary[];
  /** What's still owed, after verified payments. */
  balance: number;
}

export function invoiceStatus(inv: HumoInvoice, today: string): InvoiceStatus {
  if (inv.status === 'paid' || inv.status === 'void') return inv.status;
  return inv.dueOn < today ? 'overdue' : 'issued';
}

/** The annual renewal fee, if the renewal date falls in the period [start, end). */
export function renewalIn(a: Pick<CommercialAgreement, 'renewal'>, periodStart: string, periodEnd: string): InvoiceLine | null {
  const { on, fee, priceSource } = a.renewal;
  if (!fee || on < periodStart || on >= periodEnd) return null;
  return { description: `Annual renewal fee (renews ${on})`, kind: 'renewal-fee', quantity: 1, unitPrice: fee, amount: fee, priceSource };
}

/** The invoice for a billing period, from the agreement as it stood. */
export function buildInvoice(a: CommercialAgreement, periodStart: string, ctx: ChargeContext, opts: { id: string; reference: string; issuedOn: string; simulated: boolean }): HumoInvoice {
  const months = a.cycle === 'annual' ? 12 : 1;
  const end = new Date(`${periodStart}T00:00:00`);
  end.setMonth(end.getMonth() + months);
  const periodEnd = isoDay(end);
  const days = (x: string, y: string) => Math.round((new Date(`${y}T00:00:00`).getTime() - new Date(`${x}T00:00:00`).getTime()) / 86_400_000);
  const periodDays = days(periodStart, periodEnd);
  const policy = ctx.catalogue.settings.proration;
  const lines: InvoiceLine[] = [];
  const charge = (on: string, share: number) => {
    for (const l of chargesOn(a, on, ctx).recurring) {
      if (l.amount === null) continue;
      lines.push({ description: `${l.label}${share < 1 ? ` (${Math.round(share * periodDays)} of ${periodDays} days)` : ''}`, kind: l.kind, quantity: l.quantity, unitPrice: round2((l.amount * months * share) / l.quantity), amount: round2(l.amount * months * share), priceSource: l.priceSource });
    }
  };
  if (policy === 'next-cycle') charge(periodStart, 1);
  else {
    // Daily pro-rata: each stretch of the period with the same lines is charged for its days.
    const changes = [...new Set([periodStart, ...[...a.packages, ...a.addOns, ...a.adjustments].flatMap((l) => [l.from, l.until ?? '']).filter((d) => d > periodStart && d < periodEnd)])].sort();
    changes.forEach((from, i) => charge(from, days(from, changes[i + 1] ?? periodEnd) / periodDays));
  }
  const due = new Date(`${opts.issuedOn}T00:00:00`);
  due.setDate(due.getDate() + ctx.catalogue.settings.paymentTermsDays);
  const pendingCharges = chargesOn(a, periodStart, ctx);
  for (const l of [...pendingCharges.onceOff, ...pendingCharges.credits]) lines.push({ description: l.label, kind: l.kind, quantity: 1, unitPrice: l.amount!, amount: l.amount!, priceSource: 'negotiated' });
  const renewal = renewalIn(a, periodStart, periodEnd);
  if (renewal) lines.push(renewal);
  const subtotal = round2(lines.reduce((n, l) => n + l.amount, 0));
  const tax = ctx.catalogue.settings.tax;
  const taxAmount = tax.vatRegistered ? round2((subtotal * tax.ratePercent) / 100) : 0;
  return {
    id: opts.id,
    reference: opts.reference,
    organisationId: a.organisationId,
    periodStart,
    periodEnd,
    issuedOn: opts.issuedOn,
    dueOn: isoDay(due),
    lines,
    subtotal,
    tax: { registered: tax.vatRegistered, ratePercent: tax.ratePercent, amount: taxAmount },
    total: round2(subtotal + taxAmount),
    status: 'issued',
    simulated: opts.simulated,
  };
}
