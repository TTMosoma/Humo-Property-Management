import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import {
  ADD_ONS,
  DEFAULT_HEALTH_WEIGHTS,
  FEATURES,
  FeatureModule,
  MODULE_LABELS,
  NUDGES,
  OPPORTUNITY_RULES,
  PACKAGES,
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
  protected readonly session = inject(SessionService);
  protected readonly packages = PACKAGES;
  protected readonly addOns = ADD_ONS;
  protected readonly nudges = NUDGES;
  protected readonly rules = OPPORTUNITY_RULES;
  protected readonly roleLabel = (r: Role) => ROLE_LABELS[r];
  protected readonly weights = Object.entries(DEFAULT_HEALTH_WEIGHTS).map(([k, w]) => ({ key: k.replace('-', ' '), w: Math.round(w * 100) }));

  private readonly included = new Map(PACKAGES.map((p) => [p.id, packageFeatures(p.id)]));
  protected readonly groups = MODULES.map((m) => ({ module: m, label: MODULE_LABELS[m], features: FEATURES.filter((f) => f.module === m) }));

  protected has(pkg: string, feature: string): boolean {
    return this.included.get(pkg as never)?.has(feature as never) ?? false;
  }

  protected addOnFor(feature: string): string | null {
    return ADD_ONS.find((a) => a.features.includes(feature as never))?.name ?? null;
  }
}
