import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import {
  AddOn,
  AddOnId,
  Catalogue,
  CatalogueDataSource,
  EntitlementSet,
  Feature,
  FeatureDef,
  FeatureModule,
  MODULE_KEY_FEATURE,
  MODULE_LABELS,
  Package,
  PackageId,
} from '../../domain';

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

const EMPTY: Catalogue = { features: [], packages: [], addOns: [] };

/**
 * The product catalogue — features, packages, add-ons — as the API publishes
 * it (`CatalogueDataSource`), loaded once. Screens use it for names and
 * explanations; whether a feature is ON for a customer always comes from their
 * entitlements, never from working it out here.
 *
 * Lookups are arrow properties so components can hand them to templates directly.
 */
@Injectable({ providedIn: 'root' })
export class CatalogueService {
  private readonly data = toSignal(inject(CatalogueDataSource).catalogue().pipe(catchError(() => of(EMPTY))), { initialValue: EMPTY });

  readonly features = computed<FeatureDef[]>(() => this.data().features);
  readonly packages = computed<Package[]>(() => this.data().packages);
  readonly addOns = computed<AddOn[]>(() => this.data().addOns);

  private readonly featureMap = computed(() => new Map(this.features().map((f) => [f.key, f])));

  readonly feature = (key: Feature | string): FeatureDef | undefined => this.featureMap().get(key as Feature);
  readonly featureLabel = (key: Feature | string): string => this.feature(key)?.label ?? key;
  readonly packageName = (id: PackageId): string => this.packages().find((p) => p.id === id)?.name ?? id;
  readonly shortPackage = (id: PackageId): string => this.packageName(id).replace('Humo ', '');
  readonly addOnName = (id: AddOnId): string => this.addOns().find((a) => a.id === id)?.name ?? id;
  /** The add-on that brings a feature, if any. */
  readonly addOnFor = (feature: Feature | string): AddOn | undefined => this.addOns().find((a) => a.features.includes(feature as Feature));
  /** The first package tier that includes a feature. */
  readonly tierOf = (feature: Feature): Package | undefined => this.packages().find((p) => p.features.includes(feature));

  /** Every feature a package includes, following `extends`. */
  readonly packageFeatures = (id: PackageId): Set<Feature> => {
    const out = new Set<Feature>();
    let pkg = this.packages().find((p) => p.id === id);
    while (pkg) {
      pkg.features.forEach((f) => out.add(f));
      pkg = pkg.extends ? this.packages().find((p) => p.id === pkg!.extends) : undefined;
    }
    return out;
  };

  /** A subscription's modules ("Governance OFF"), each with its features and where they come from. */
  readonly moduleRows = (ent: EntitlementSet): ModuleRow[] =>
    SUMMARY.map(({ module, label }) => {
      const features = this.features()
        .filter((f) => f.module === module)
        .map((f) => {
          const e = ent.get(f.key);
          return { key: f.key, label: f.label, enabled: e.enabled, source: e.sourceLabel, sourceKind: e.source, description: f.description };
        });
      const enabled = features.filter((f) => f.enabled);
      const sources = [...new Set(enabled.map((f) => f.source))];
      // A module is "on" when its core feature is; extras (e.g. WhatsApp) don't make it "off".
      const on = ent.has(MODULE_KEY_FEATURE[module]);
      return { module, label: label || MODULE_LABELS[module], on, partial: on && enabled.length < features.length, source: sources.join(' + ') || 'Not included', features };
    });
}
