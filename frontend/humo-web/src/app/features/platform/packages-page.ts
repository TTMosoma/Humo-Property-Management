import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CatalogueService } from '../../core/catalogue/catalogue.service';
import { IonIcon } from '@ionic/angular/standalone';
import {
  DEFAULT_HEALTH_WEIGHTS,
  FeatureModule,
  MODULE_LABELS,
  NUDGES,
  OPPORTUNITY_RULES,
  ROLE_LABELS,
  Role,
  packageFeatures,
} from '../../domain';
import { SessionService } from '../../core/session/session.service';
import { PageHeader } from '../../ui/page-header/page-header';

const MODULES: FeatureModule[] = ['portfolio', 'finance', 'maintenance', 'communications', 'documents', 'governance', 'compliance', 'reporting', 'platform'];

/**
 * Platform › Packages & features: the commercial catalogue and the rules that
 * run the flywheel (health weights, opportunity rules, nudges and their
 * frequency). Read-only today; System Administrators will edit it here.
 */
@Component({
  selector: 'app-packages-page',
  imports: [PageHeader, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './packages-page.html',
  styleUrl: './packages-page.scss',
})
export class PackagesPage {
  protected readonly catalogue = inject(CatalogueService);
  protected readonly session = inject(SessionService);
  protected readonly packages = this.catalogue.packages;
  protected readonly addOns = this.catalogue.addOns;
  protected readonly nudges = NUDGES;
  protected readonly rules = OPPORTUNITY_RULES;
  protected readonly roleLabel = (r: Role) => ROLE_LABELS[r];
  protected readonly weights = Object.entries(DEFAULT_HEALTH_WEIGHTS).map(([k, w]) => ({ key: k.replace('-', ' '), w: Math.round(w * 100) }));

  private readonly included = computed(() => new Map(this.packages().map((p) => [p.id, this.catalogue.packageFeatures(p.id)])));
  protected readonly groups = computed(() =>
    MODULES.map((m) => ({ module: m, label: MODULE_LABELS[m], features: this.catalogue.features().filter((f) => f.module === m) })),
  );

  protected has(pkg: string, feature: string): boolean {
    return this.included().get(pkg as never)?.has(feature as never) ?? false;
  }

  protected addOnFor(feature: string): string | null {
    return this.catalogue.addOnFor(feature)?.name ?? null;
  }
}
