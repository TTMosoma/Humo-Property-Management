/**
 * Commercial model: what a customer can USE.
 *
 *   Customer → Subscription → Package → Base entitlements → Add-ons / Overrides → Effective entitlements
 *
 * Nothing in Humo Property Management asks "is this customer Enterprise?". Code asks one question —
 * `entitlements.has('governance')` — and never needs to know whether the
 * feature came from the package, an add-on or a trial override.
 *
 * Packages are not the security mechanism either: the API checks the effective
 * entitlement on every request, alongside role permissions and scope.
 */

export type FeatureModule = 'portfolio' | 'finance' | 'maintenance' | 'communications' | 'documents' | 'governance' | 'compliance' | 'reporting' | 'platform';

export type Feature =
  // Portfolio
  | 'agency-management'
  | 'schemes'
  | 'units'
  | 'owners-tenants'
  | 'resident-portal'
  | 'team-management'
  // Finance
  | 'finance-basic'
  | 'levies'
  | 'billing'
  | 'statements'
  | 'payment-allocation'
  | 'debtors'
  | 'credit-control'
  | 'payables'
  | 'budgets'
  // Maintenance
  | 'maintenance-basic'
  | 'maintenance-advanced'
  | 'suppliers'
  | 'contractors'
  // Communications & documents
  | 'communications'
  | 'whatsapp'
  | 'documents'
  | 'storage-extra'
  | 'document-templates-premium'
  | 'document-branding'
  | 'document-templates-custom'
  // Governance & compliance
  | 'governance'
  | 'trustee-management'
  | 'meetings'
  | 'agm-sgm'
  | 'compliance'
  // Reporting
  | 'reporting-basic'
  | 'reporting-financial'
  | 'reporting-advanced'
  | 'analytics-advanced'
  // Platform & security
  | 'permissions-advanced'
  | 'integrations'
  | 'api'
  | 'automation'
  | 'automation-advanced'
  | 'audit-log'
  | 'mobile-approvals';

export interface FeatureDef {
  key: Feature;
  label: string;
  module: FeatureModule;
  description: string;
  /** Security features are in every package: Humo never sells safety as an upgrade. */
  baseline?: boolean;
}

export const MODULE_LABELS: Record<FeatureModule, string> = {
  portfolio: 'Portfolio',
  finance: 'Finance',
  maintenance: 'Maintenance',
  communications: 'Communications',
  documents: 'Documents',
  governance: 'Governance',
  compliance: 'Compliance',
  reporting: 'Reporting',
  platform: 'Platform & security',
};

export const FEATURES: FeatureDef[] = [
  { key: 'agency-management', module: 'portfolio', label: 'Agency management', description: 'Agency profile, branding and settings.' },
  { key: 'schemes', module: 'portfolio', label: 'Schemes', description: 'Sectional title schemes, HOAs and share blocks.' },
  { key: 'units', module: 'portfolio', label: 'Units', description: 'Units, participation quotas and occupancy.' },
  { key: 'owners-tenants', module: 'portfolio', label: 'Owners & tenants', description: 'People, contacts and relationships to units.' },
  { key: 'resident-portal', module: 'portfolio', label: 'Owner & tenant portal', description: 'Residents see their account, requests and notices.' },
  { key: 'team-management', module: 'portfolio', label: 'Team management', description: 'Staff workload, scheme assignment and cover.' },
  { key: 'finance-basic', module: 'finance', label: 'Basic finance', description: 'Owner accounts and balances.' },
  { key: 'levies', module: 'finance', label: 'Levy management', description: 'Levy schedules, special levies and quotas.' },
  { key: 'billing', module: 'finance', label: 'Billing runs', description: 'Monthly billing with approval and posting.' },
  { key: 'statements', module: 'finance', label: 'Statements', description: 'Generated and sent owner statements.' },
  { key: 'payment-allocation', module: 'finance', label: 'Payment allocation', description: 'Bank receipts matched and allocated to accounts.' },
  { key: 'debtors', module: 'finance', label: 'Debtors', description: 'Age analysis and arrears.' },
  { key: 'credit-control', module: 'finance', label: 'Credit control', description: 'Structured collections pipeline.' },
  { key: 'payables', module: 'finance', label: 'Supplier payments', description: 'Invoices, payment batches and dual authorisation.' },
  { key: 'budgets', module: 'finance', label: 'Budgets', description: 'Budget vs actual per scheme.' },
  { key: 'maintenance-basic', module: 'maintenance', label: 'Basic maintenance', description: 'Log and track maintenance requests.' },
  { key: 'maintenance-advanced', module: 'maintenance', label: 'Advanced maintenance', description: 'Quotes, delegated approval, work orders, verification.' },
  { key: 'suppliers', module: 'maintenance', label: 'Suppliers', description: 'Supplier records and vetting documents.' },
  { key: 'contractors', module: 'maintenance', label: 'Contractors', description: 'Contractor performance and scheduling.' },
  { key: 'communications', module: 'communications', label: 'Communication', description: 'Email, SMS and portal notices.' },
  { key: 'whatsapp', module: 'communications', label: 'WhatsApp', description: 'Send notices and reminders on WhatsApp.' },
  { key: 'documents', module: 'documents', label: 'Documents', description: 'Document library with visibility rules.' },
  { key: 'storage-extra', module: 'documents', label: 'Additional storage', description: 'More document storage.' },
  { key: 'document-templates-premium', module: 'documents', label: 'Premium document templates', description: 'Professional and detailed layouts for statements and other documents.' },
  { key: 'document-branding', module: 'documents', label: 'Document branding', description: 'Your logo, colours and font on the documents you send.' },
  { key: 'document-templates-custom', module: 'documents', label: 'Custom document templates', description: 'Your organisation’s own template: layout, colours, wording and legal text.' },
  { key: 'governance', module: 'governance', label: 'Governance', description: 'Trustee workflows in one place.' },
  { key: 'trustee-management', module: 'governance', label: 'Trustee management', description: 'Boards, terms and trustee roles.' },
  { key: 'meetings', module: 'governance', label: 'Meetings', description: 'Agendas, packs, minutes, resolutions and actions.' },
  { key: 'agm-sgm', module: 'governance', label: 'AGM / SGM', description: 'Notices, quorum, proxies and voting.' },
  { key: 'compliance', module: 'compliance', label: 'Compliance', description: 'Statutory deadlines and evidence across schemes.' },
  { key: 'reporting-basic', module: 'reporting', label: 'Basic reporting', description: 'Standard operational reports.' },
  { key: 'reporting-financial', module: 'reporting', label: 'Financial reporting', description: 'Income statement, balance sheet, levy roll.' },
  { key: 'reporting-advanced', module: 'reporting', label: 'Advanced reporting', description: 'Custom reports, scheduling and exports.' },
  { key: 'analytics-advanced', module: 'reporting', label: 'Advanced analytics', description: 'Portfolio trends and benchmarks.' },
  { key: 'permissions-advanced', module: 'platform', label: 'Advanced permissions', description: 'Custom roles and fine-grained access.' },
  { key: 'integrations', module: 'platform', label: 'Integrations', description: 'Accounting and banking connectors.' },
  { key: 'api', module: 'platform', label: 'API access', description: 'Programmatic access to Humo Property Management data.' },
  { key: 'automation', module: 'platform', label: 'Automation', description: 'Rules that create tasks and send reminders.' },
  { key: 'automation-advanced', module: 'platform', label: 'Advanced automation', description: 'Multi-step automated workflows.' },
  { key: 'audit-log', module: 'platform', label: 'Audit log', description: 'Every action, recorded and exportable.', baseline: true },
  { key: 'mobile-approvals', module: 'platform', label: 'Passkeys & Humo Mobile', description: 'Device-native sign-in and step-up.', baseline: true },
];

export const FEATURE_META: Record<Feature, FeatureDef> = Object.fromEntries(FEATURES.map((f) => [f.key, f])) as Record<Feature, FeatureDef>;
/** @deprecated Use FEATURE_META[f].label. */
export const FEATURE_LABELS: Record<Feature, string> = Object.fromEntries(FEATURES.map((f) => [f.key, f.label])) as Record<Feature, string>;

// ---------------------------------------------------------------- Packages & add-ons

export type PackageId = 'essentials' | 'professional' | 'enterprise';

/** A named collection of features. Packages may build on another package. */
export interface Package {
  id: PackageId;
  /** Packages belong to one Humo product; Humo Valuations or Humo Contractor will have their own. */
  product: 'property-management';
  name: string;
  tagline: string;
  extends?: PackageId;
  /** Features added at this tier (inherited ones come from `extends`). */
  features: Feature[];
}

export const PACKAGES: Package[] = [
  {
    id: 'essentials',
    product: 'property-management',
    name: 'Humo Essentials',
    tagline: 'For smaller agencies getting their portfolio in order.',
    features: [
      'agency-management', 'schemes', 'units', 'owners-tenants', 'resident-portal', 'documents', 'communications',
      'maintenance-basic', 'reporting-basic', 'finance-basic', 'audit-log', 'mobile-approvals',
    ],
  },
  {
    id: 'professional',
    product: 'property-management',
    name: 'Humo Professional',
    tagline: 'Full financial and maintenance operations.',
    extends: 'essentials',
    features: [
      'levies', 'billing', 'statements', 'payment-allocation', 'debtors', 'credit-control', 'payables', 'suppliers', 'contractors',
      'maintenance-advanced', 'reporting-financial', 'budgets', 'team-management', 'document-templates-premium', 'document-branding',
    ],
  },
  {
    id: 'enterprise',
    product: 'property-management',
    name: 'Humo Enterprise',
    tagline: 'Governance, compliance and scale.',
    extends: 'professional',
    features: [
      'governance', 'trustee-management', 'meetings', 'agm-sgm', 'compliance', 'reporting-advanced', 'permissions-advanced',
      'integrations', 'api', 'automation', 'analytics-advanced', 'document-templates-custom',
    ],
  },
];

export type KnownAddOnId = 'governance' | 'compliance' | 'advanced-reporting' | 'api-access' | 'whatsapp' | 'advanced-automation' | 'integrations' | 'document-branding-pack';
/** Add-ons are catalogue data (docs/23): new ones, such as the 10, 50 and 100 GB storage packs, need no code change. */
export type AddOnId = KnownAddOnId | (string & {});

/** Features sold independently of the package. */
export interface AddOn {
  id: AddOnId;
  name: string;
  description: string;
  features: Feature[];
}

export const ADD_ONS: AddOn[] = [
  { id: 'governance', name: 'Governance', description: 'Trustee boards, meetings, AGMs and resolutions.', features: ['governance', 'trustee-management', 'meetings', 'agm-sgm'] },
  { id: 'compliance', name: 'Compliance', description: 'Statutory deadlines across every scheme, generated from your records.', features: ['compliance'] },
  { id: 'advanced-reporting', name: 'Advanced Reporting', description: 'Custom and scheduled reports, analytics.', features: ['reporting-advanced', 'analytics-advanced'] },
  { id: 'api-access', name: 'API Access', description: 'Programmatic access to Humo Property Management data.', features: ['api'] },
  { id: 'whatsapp', name: 'WhatsApp', description: 'Notices and reminders on WhatsApp.', features: ['whatsapp'] },
  { id: 'advanced-automation', name: 'Advanced Automation', description: 'Automated multi-step workflows.', features: ['automation', 'automation-advanced'] },
  { id: 'integrations', name: 'Integrations', description: 'Accounting and banking connectors.', features: ['integrations'] },
  { id: 'document-branding-pack', name: 'Document & Branding Pack', description: 'Premium document templates and your own branding on documents.', features: ['document-templates-premium', 'document-branding'] },
];

// ---------------------------------------------------------------- Subscription

export type SubscriptionStatus = 'trial' | 'active' | 'past-due' | 'suspended' | 'cancelled';

/** A per-customer exception: a trial, a goodwill grant, or switching something off. */
export interface FeatureOverride {
  feature: Feature;
  enabled: boolean;
  reason: string;
  by: string;
  at: string;
  /** Trials and temporary grants expire; the package/add-on value applies again after. */
  expiresAt?: string;
}

export interface SubscriptionAddOn {
  addOnId: AddOnId;
  since: string;
}

export interface Subscription {
  organisationId: string;
  /** Concurrency token: send it back with commands that change this record. The API answers 409 if someone changed it first. */
  version: number;
  packageId: PackageId;
  status: SubscriptionStatus;
  startedAt: string;
  renewsAt: string;
  addOns: SubscriptionAddOn[];
  overrides: FeatureOverride[];
  /** Contract value per month (rands) — a recorded figure, not a pricing calculation. */
  mrr: number;
  seats: number;
}

// ---------------------------------------------------------------- Effective entitlements

export type EntitlementSource = 'package' | 'add-on' | 'override' | 'none';

export interface Entitlement {
  feature: Feature;
  enabled: boolean;
  source: EntitlementSource;
  /** e.g. "Humo Professional", "Governance add-on", "Trial until 31 Oct". */
  sourceLabel: string;
}

export interface EntitlementSet {
  has(feature: Feature): boolean;
  get(feature: Feature): Entitlement;
  all: Entitlement[];
}

export function packageById(id: PackageId): Package {
  return PACKAGES.find((p) => p.id === id)!;
}

/** Every feature a package includes, following `extends`. */
export function packageFeatures(id: PackageId): Set<Feature> {
  const pkg = packageById(id);
  const inherited = pkg.extends ? packageFeatures(pkg.extends) : new Set<Feature>();
  return new Set([...inherited, ...pkg.features]);
}

/** The package tier a feature first appears in (for "Included from Professional"). */
export function tierOf(feature: Feature): Package | undefined {
  return PACKAGES.find((p) => p.features.includes(feature));
}

/**
 * The entitlement engine. Pure and order-defined:
 *   1. package (with inheritance)  2. add-ons  3. unexpired overrides (last word)
 * `addOns` is the published catalogue's add-ons (the seed constants by default).
 * A suspended or cancelled subscription keeps only baseline security features.
 */
export function resolveEntitlements(sub: Subscription | undefined, now = new Date(), addOns: Pick<AddOn, 'id' | 'name' | 'features'>[] = ADD_ONS): EntitlementSet {
  const map = new Map<Feature, Entitlement>();
  const fromPackage = sub ? packageFeatures(sub.packageId) : new Set<Feature>();
  const pkgName = sub ? packageById(sub.packageId).name : '';

  for (const f of FEATURES) {
    map.set(f.key, fromPackage.has(f.key)
      ? { feature: f.key, enabled: true, source: 'package', sourceLabel: pkgName }
      : { feature: f.key, enabled: false, source: 'none', sourceLabel: 'Not included' });
  }
  for (const a of sub?.addOns ?? []) {
    const def = addOns.find((x) => x.id === a.addOnId);
    for (const f of def?.features ?? []) {
      if (!map.get(f)!.enabled) map.set(f, { feature: f, enabled: true, source: 'add-on', sourceLabel: `${def!.name} add-on` });
    }
  }
  for (const o of sub?.overrides ?? []) {
    if (o.expiresAt && new Date(o.expiresAt) < now) continue;
    const until = o.expiresAt ? ` until ${new Date(o.expiresAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` : '';
    map.set(o.feature, { feature: o.feature, enabled: o.enabled, source: 'override', sourceLabel: o.enabled ? `Granted${until} · ${o.reason}` : `Switched off · ${o.reason}` });
  }
  if (sub && (sub.status === 'suspended' || sub.status === 'cancelled')) {
    for (const f of FEATURES.filter((x) => !x.baseline)) {
      map.set(f.key, { feature: f.key, enabled: false, source: 'none', sourceLabel: `Subscription ${sub.status}` });
    }
  }

  return entitlementSet(FEATURES.map((f) => map.get(f.key)!));
}

/**
 * Entitlements travel as a plain list (that's what the API sends); this wraps
 * one for lookups. Unknown features count as off.
 */
export function entitlementSet(all: Entitlement[]): EntitlementSet {
  const map = new Map(all.map((e) => [e.feature, e]));
  return {
    all,
    has: (f) => map.get(f)?.enabled ?? false,
    get: (f) => map.get(f) ?? { feature: f, enabled: false, source: 'none', sourceLabel: 'Not included' },
  };
}

/** Module-level summary ("Governance OFF") from the effective set: on when its key feature is on. */
export const MODULE_KEY_FEATURE: Record<FeatureModule, Feature> = {
  portfolio: 'schemes',
  finance: 'finance-basic',
  maintenance: 'maintenance-basic',
  communications: 'communications',
  documents: 'documents',
  governance: 'governance',
  compliance: 'compliance',
  reporting: 'reporting-advanced',
  platform: 'audit-log',
};
