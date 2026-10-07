import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { ADD_ONS, MODULE_LABELS, Opportunity, PlatformCustomer, PlatformDataSource, UpgradeRequest, packageById } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { pageState } from '../../core/prototype/page-state';
import { SessionService } from '../../core/session/session.service';
import { ScoreRing, Sparkline } from '../../ui/charts/charts';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate, formatRand } from '../../ui/format/money';
import { relativeTime } from '../../ui/format/relative-time';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { ManageFeaturesDrawer } from './manage-features-drawer';
import { BAND_LABEL, BAND_TONE, STATUS_LABEL, STATUS_TONE, addOnName, moduleRows, packageName } from './platform-view';

/**
 * A customer, from Humo's side: how they're doing (health, adoption), what
 * would help them (opportunities, their own requests) and what they have
 * (subscription and effective entitlements). Shaped by permission — an
 * Executive sees the account, not its people.
 */
@Component({
  selector: 'app-customer-page',
  imports: [ViewTabs, StatusPill, ScoreRing, Sparkline, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-page.html',
  styleUrl: './customer-page.scss',
})
export class CustomerPage {
  private readonly data = inject(PlatformDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);
  protected readonly page = pageState();
  protected readonly state = urlState({ view: 'overview' });

  private readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('agencyId')!)), { initialValue: '' });
  protected readonly result = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) => this.data.customer(id).pipe(map((c) => c ?? (false as const)), catchError(() => of(null)))),
    ),
  );
  protected readonly c = computed(() => {
    const r = this.result();
    return r ? r : undefined;
  });

  protected readonly revenue = computed(() => this.session.can('Platform.Revenue.View'));
  protected readonly canManage = computed(() => this.session.can('Platform.Subscriptions.Manage'));
  protected readonly ownAccount = computed(() => this.session.role() !== 'humo-account-manager' || this.c()?.accountManagerId === this.session.actor().id);
  protected readonly canWorkRequests = computed(() => this.session.can('Platform.Opportunities.Manage'));

  protected readonly tabs = computed(() => [
    { id: 'overview', label: 'Health & opportunities' },
    { id: 'subscription', label: 'Subscription & features' },
  ]);

  protected readonly modules = computed(() => {
    const c = this.c();
    return c ? moduleRows(c.entitlements) : [];
  });

  protected readonly adoption = computed(() =>
    (this.c()?.health.modules ?? []).map((m) => ({ ...m, label: MODULE_LABELS[m.module] })),
  );

  protected readonly opportunities = computed(() => (this.c()?.opportunities ?? []).filter((o) => o.kind !== 'adoption'));
  protected readonly adoptionHelp = computed(() => (this.c()?.opportunities ?? []).filter((o) => o.kind === 'adoption'));

  protected readonly bandLabel = BAND_LABEL;
  protected readonly bandTone = BAND_TONE;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly statusTone = STATUS_TONE;
  protected readonly packageName = packageName;
  protected readonly addOnName = addOnName;
  protected readonly formatDate = formatDate;
  protected readonly relativeTime = relativeTime;
  protected readonly rand = (n: number, compact = false) => formatRand(n, { compact, cents: false });

  /** A suggested, human opener — the reason to call, not a pitch. */
  protected talkingPoint(o: Opportunity, c: PlatformCustomer): string {
    switch (o.rule) {
      case 'governance-addon':
        return `Ask how ${c.name} runs trustee meetings today — ${o.reasons[0]} and ${o.reasons[1]} is a lot to track in email and spreadsheets.`;
      case 'advanced-reporting-addon':
        return `They export reports often. Ask which ones trustees ask for, and whether they rebuild them each month.`;
      case 'professional-upgrade':
        return `Ask how they reconcile receipts today; Professional allocates bank receipts to owner accounts.`;
      default:
        return 'Offer a short training session on the areas they use least.';
    }
  }

  protected requestLabel(r: UpgradeRequest): string {
    if (r.addOn) return `${ADD_ONS.find((a) => a.id === r.addOn)?.name} add-on`;
    if (r.package) return packageById(r.package).name;
    return 'Upgrade';
  }

  protected setView(v: string): void {
    this.state.set({ view: v });
  }

  protected manage(): void {
    const c = this.c();
    if (c) this.drawer.open(ManageFeaturesDrawer, { agencyId: c.agencyId }, `Manage features for ${c.name}`);
  }

  protected setRequest(r: UpgradeRequest, status: UpgradeRequest['status']): void {
    this.data.updateRequest(r.id, status).subscribe({
      next: () => this.feedback.success(status === 'done' ? 'Request closed.' : 'Marked in progress.'),
      error: () => this.feedback.error('That didn’t save.'),
    });
  }
}
