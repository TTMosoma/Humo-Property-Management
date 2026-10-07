import { ADD_ONS, AddOnId, EntitlementSet, FEATURES, FeatureModule, HealthBand, MODULE_KEY_FEATURE, MODULE_LABELS, PackageId, SubscriptionStatus, packageById } from '../../domain';

export const BAND_LABEL: Record<HealthBand, string> = { healthy: 'Healthy', 'at-risk': 'At risk', critical: 'Critical' };
export const BAND_TONE: Record<HealthBand, 'success' | 'warning' | 'danger'> = { healthy: 'success', 'at-risk': 'warning', critical: 'danger' };

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trial: 'Trial',
  active: 'Active',
  'past-due': 'Payment overdue',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};
export const STATUS_TONE: Record<SubscriptionStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  trial: 'info',
  active: 'success',
  'past-due': 'warning',
  suspended: 'danger',
  cancelled: 'neutral',
};

export const packageName = (id: PackageId) => packageById(id).name;
export const shortPackage = (id: PackageId) => packageById(id).name.replace('Humo ', '');
export const addOnName = (id: AddOnId) => ADD_ONS.find((a) => a.id === id)?.name ?? id;

/** The headline rows of a subscription ("Governance OFF"), each backed by its features. */
export interface ModuleRow {
  module: FeatureModule;
  label: string;
  on: boolean;
  /** Some but not all of the module's features. */
  partial: boolean;
  source: string;
  features: { key: string; label: string; enabled: boolean; source: string; sourceKind: string; description: string }[];
}

const SUMMARY: { module: FeatureModule; label: string }[] = [
  { module: 'portfolio', label: 'Portfolio' },
  { module: 'finance', label: 'Finance' },
  { module: 'maintenance', label: 'Maintenance' },
  { module: 'communications', label: 'Communications' },
  { module: 'documents', label: 'Documents' },
  { module: 'governance', label: 'Governance' },
  { module: 'compliance', label: 'Compliance' },
  { module: 'reporting', label: 'Advanced reporting' },
  { module: 'platform', label: 'Platform & security' },
];

export function moduleRows(ent: EntitlementSet): ModuleRow[] {
  return SUMMARY.map(({ module, label }) => {
    const features = FEATURES.filter((f) => f.module === module).map((f) => {
      const e = ent.get(f.key);
      return { key: f.key, label: f.label, enabled: e.enabled, source: e.sourceLabel, sourceKind: e.source, description: f.description };
    });
    const enabled = features.filter((f) => f.enabled);
    const sources = [...new Set(enabled.map((f) => f.source))];
    // A module is "on" when its core feature is; extras (e.g. WhatsApp) don't make it "off".
    const on = ent.has(MODULE_KEY_FEATURE[module]);
    return {
      module,
      label: label || MODULE_LABELS[module],
      on,
      partial: on && enabled.length < features.length,
      source: sources.join(' + ') || 'Not included',
      features,
    };
  });
}
