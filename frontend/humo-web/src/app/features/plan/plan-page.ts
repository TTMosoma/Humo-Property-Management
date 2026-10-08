import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CatalogueService } from '../../core/catalogue/catalogue.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of } from 'rxjs';
import { AddOnId, Feature, PlanDataSource, UpgradeRequest, entitlementSet } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { formatDate } from '../../ui/format/money';
import { relativeTime } from '../../ui/format/relative-time';
import { PageHeader } from '../../ui/page-header/page-header';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { STATUS_LABEL, STATUS_TONE } from '../platform/platform-view';

/**
 * Settings › Plan & features — the customer's own view. It shows what the
 * agency has and where each feature comes from. Administrators can ask Humo
 * about more; nobody on the customer side can switch paid features on.
 */
@Component({
  selector: 'app-plan-page',
  imports: [PageHeader, StatusPill, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan-page.html',
  styleUrl: './plan-page.scss',
})
export class PlanPage {
  protected readonly catalogue = inject(CatalogueService);
  private readonly data = inject(PlanDataSource);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);

  /** Arrived from a nudge or "Learn more": e.g. ?feature=governance. */
  protected readonly focus = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((p) => p.get('feature') as Feature | null)), { initialValue: null });

  protected readonly result = loadable(() => this.data.mine(this.session.organisation()?.id ?? '').pipe(map((plan) => ({ plan }))));
  protected readonly loading = this.result.loading;
  /** No plan on record counts as a failure: the page can't say anything useful without one. */
  protected readonly failed = computed(() => this.result.failed() || (!this.loading() && !this.result.value()?.plan));
  protected readonly plan = computed(() => this.result.value()?.plan);

  protected readonly rows = computed(() => {
    const p = this.plan();
    return p ? this.catalogue.moduleRows(entitlementSet(p.entitlements)).filter((r) => r.module !== 'platform') : [];
  });
  protected readonly focusModule = computed(() => {
    const f = this.focus();
    return f ? this.catalogue.feature(f)?.module : null;
  });

  protected readonly canRequest = computed(() => this.session.can('Subscription.Request'));
  protected readonly asking = signal<string | null>(null);
  protected readonly note = signal('');
  protected readonly busy = signal(false);

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly statusTone = STATUS_TONE;
  protected readonly formatDate = formatDate;
  protected readonly relativeTime = relativeTime;
  protected readonly packageName = this.catalogue.packageName;
  protected readonly addOnName = this.catalogue.addOnName;

  /** How a module could be added: as an add-on, or from a higher package. */
  protected howToGet(module: string): { addOn?: AddOnId; label: string } {
    const row = this.rows().find((r) => r.module === module);
    const missing = row?.features.find((f) => !f.enabled)?.key as Feature | undefined;
    if (!missing) return { label: '' };
    const addOn = this.catalogue.addOnFor(missing);
    if (addOn) return { addOn: addOn.id, label: `Available as the ${addOn.name} add-on` };
    const tier = this.catalogue.tierOf(missing);
    return { label: tier ? `Included in ${tier.name}` : '' };
  }

  protected requestLabel(r: UpgradeRequest): string {
    return r.addOn ? `${this.addOnName(r.addOn)} add-on` : r.package ? this.packageName(r.package) : 'Upgrade';
  }

  protected ask(module: string): void {
    this.asking.set(module);
    this.note.set('');
  }

  protected send(module: string): void {
    const how = this.howToGet(module);
    const p = this.plan();
    if (!p) return;
    this.busy.set(true);
    const feature = this.rows().find((r) => r.module === module)?.features.find((f) => !f.enabled)?.key as Feature | undefined;
    this.data
      .requestUpgrade({ organisationId: p.organisationId, addOn: how.addOn, feature, note: this.note().trim() || undefined, source: this.focus() ? 'nudge' : 'plan-page' })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.asking.set(null);
          this.feedback.success(`Sent to ${p.accountManager}, your Humo account manager. Nothing changes until you agree.`);
        },
        error: () => {
          this.busy.set(false);
          this.feedback.error('Your request didn’t send. Try again.');
        },
      });
  }
}
