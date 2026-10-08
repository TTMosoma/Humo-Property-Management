import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CatalogueService } from '../../core/catalogue/catalogue.service';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { AccessDataSource, MODULE_LABELS, ORGANISATION_STATUS_LABELS, Opportunity, Organisation, OrganisationDataSource, OrganisationStatus, PlatformCustomer, PlatformDataSource, UnitDataSource, UpgradeRequest, entitlementSet } from '../../domain';
import { editOrganisationForm, organisationStatusForm } from './organisation-forms';
import { inviteForm } from '../access/user-forms';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
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
import { BAND_LABEL, BAND_TONE, STATUS_LABEL, STATUS_TONE } from './platform-view';

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
  protected readonly catalogue = inject(CatalogueService);
  private readonly data = inject(PlatformDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);
  protected readonly state = urlState({ view: 'overview' });

  private readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('organisationId')!)), { initialValue: '' });
  protected readonly result = loadable(() => {
    const id = this.id();
    return this.data.customer(id).pipe(map((c) => c ?? (false as const)));
  });
  protected readonly c = computed(() => {
    const r = this.result.value();
    return r ? r : undefined;
  });

  /** The organisation record (details, lifecycle, version) behind the customer view. */
  private readonly organisations = inject(OrganisationDataSource);
  protected readonly org = toSignal(toObservable(this.id).pipe(switchMap((id) => this.organisations.get(id).pipe(catchError(() => of(undefined))))));

  private readonly access = inject(AccessDataSource);
  private readonly units = inject(UnitDataSource);

  /** Onboarding: the customer's first Agency Administrator, who then invites everyone else. */
  protected inviteAdmin(o: Organisation): void {
    inviteForm(this.drawer, this.access, this.units, o.id, o.shortName, [], true);
  }

  protected editDetails(o: Organisation): void {
    editOrganisationForm(this.drawer, this.organisations, o);
  }

  protected changeStatus(o: Organisation, status: OrganisationStatus): void {
    organisationStatusForm(this.drawer, this.organisations, o, status);
  }

  protected orgStatus(c: PlatformCustomer): string {
    return ORGANISATION_STATUS_LABELS[c.status];
  }

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
    return c ? this.catalogue.moduleRows(entitlementSet(c.entitlements)) : [];
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
  protected readonly packageName = this.catalogue.packageName;
  protected readonly addOnName = this.catalogue.addOnName;
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
    if (r.addOn) return `${this.catalogue.addOnName(r.addOn)} add-on`;
    if (r.package) return this.catalogue.packageName(r.package);
    return 'Upgrade';
  }

  protected setView(v: string): void {
    this.state.set({ view: v });
  }

  protected manage(): void {
    const c = this.c();
    if (c) this.drawer.open(ManageFeaturesDrawer, { organisationId: c.organisationId }, `Manage features for ${c.name}`);
  }

  protected setRequest(r: UpgradeRequest, status: UpgradeRequest['status']): void {
    this.data.updateRequest(r.id, status).subscribe({
      next: () => this.feedback.success(status === 'done' ? 'Request closed.' : 'Marked in progress.'),
      error: () => this.feedback.error('That didn’t save.'),
    });
  }
}
