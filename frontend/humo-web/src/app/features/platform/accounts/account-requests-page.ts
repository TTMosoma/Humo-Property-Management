import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, of } from 'rxjs';
import {
  ACCOUNT_POLICY_LABELS,
  ACCOUNT_REQUEST_STATUS_LABELS,
  ACCOUNT_ROUTE_LABELS,
  AccountPolicySetting,
  AccountRequestDataSource,
  AccountRequestView,
  ORGANISATION_STATUS_LABELS,
} from '../../../domain';
import { loadable } from '../../../core/data/loadable';
import { SessionService } from '../../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../../ui/data-table/data-table';
import { urlState } from '../../../ui/data-table/url-state';
import { ViewTabs } from '../../../ui/data-table/view-tabs';
import { formatDate } from '../../../ui/format/money';
import { relativeTime } from '../../../ui/format/relative-time';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { PageHeader } from '../../../ui/page-header/page-header';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill } from '../../../ui/status-pill/status-pill';
import { NewAccountLauncher, policyForm } from './account-request-forms';
import { REQUEST_TONE } from './account-request-view';

type View = 'waiting' | 'delegated' | 'approved' | 'rejected' | 'mine' | 'all';

/**
 * Platform › New accounts. Account Managers submit and follow their requests;
 * System Administrators approve or reject the ones waiting and keep an eye on
 * accounts activated under delegated authority. The policy card says how new
 * accounts are decided; only System Administrators can change it.
 */
@Component({
  selector: 'app-account-requests-page',
  imports: [PageHeader, ViewTabs, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Humo platform" title="New accounts" subtitle="Customer accounts requested, approved, rejected, and activated under delegated authority.">
      @if (session.can('Platform.Customers.Manage') && !session.readOnly()) {
        <button type="button" class="btn btn-primary" (click)="launcher.open()"><ion-icon name="add-outline" aria-hidden="true" /> New customer account</button>
      }
    </ui-page-header>

    @if (policy(); as p) {
      <section class="surface policy" aria-label="Account-creation policy">
        <div>
          <span class="label-caps">Policy</span>
          <strong>{{ policyLabels[p.policy] }}</strong>
          <span class="muted">
            @if (canActivate()) {
              You have delegated activation{{ p.policy === 'approval-for-all' ? ', but it’s paused by this policy: your accounts need approval.' : ': your accounts are activated when you submit them.' }}
            } @else if (session.can('Platform.Customers.Approve')) {
              You approve or reject waiting accounts. Delegated activation is granted to Account Managers individually, on the Humo team page.
            } @else {
              Your new accounts go to a System Administrator for approval.
            }
            {{ p.updatedBy ? ' Last changed by ' + p.updatedBy + ', ' + relativeTime(p.updatedAt!) + '.' : '' }}
          </span>
        </div>
        @if (canSetPolicy()) {
          <button type="button" class="btn btn-secondary btn-sm" (click)="changePolicy(p)">Change policy</button>
        }
      </section>
    }

    <ui-view-tabs label="Requests" [tabs]="tabs()" [active]="state().view ?? 'waiting'" (activeChange)="state.update((s) => ({ ...s, view: $event }))" />

    @if (result.loading()) {
      <ui-skeleton [count]="6" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the requests" (retry)="result.retry()" /></div>
    } @else if (!rows().length) {
      <div class="surface"><ui-empty-state illustration="empty-tray" title="Nothing here" message="New customer accounts appear here when they’re requested." /></div>
    } @else {
      <ui-data-table caption="New customer accounts" [rows]="rows()" [columns]="columns" [rowId]="rowId" (rowClick)="open($event)">
        <ng-template uiCell="account" let-v>
          <div class="title">{{ v.request.details.shortName }}</div>
          <div class="muted">{{ v.request.ref }} · {{ v.request.details.city }}, {{ v.request.details.province }}</div>
        </ng-template>
        <ng-template uiCell="status" let-v>
          <ui-status-pill [label]="statusLabel(v)" [tone]="tone(v)" />
          @if (v.organisationStatus) {
            <div class="muted">Customer: {{ orgLabel(v) }}</div>
          }
        </ng-template>
        <ng-template uiCell="route" let-v>{{ routeLabel(v) }}</ng-template>
        <ng-template uiCell="by" let-v>
          <div>{{ v.request.requestedBy }}</div>
          <div class="muted">{{ formatDate(v.request.requestedAt) }}</div>
        </ng-template>
        <ng-template uiCell="decided" let-v>
          @if (v.request.decidedAt) {
            <div>{{ v.request.route === 'delegated' ? 'Activated by ' : '' }}{{ v.request.decidedBy }}</div>
            <div class="muted">{{ formatDate(v.request.decidedAt) }}</div>
          } @else {
            <span class="muted">—</span>
          }
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    :host { display: block; }
    .policy { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-4); padding: var(--s-4) var(--s-5); }
    .policy > div { display: flex; flex-direction: column; gap: 2px; }
    .title { font-weight: var(--fw-medium); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
  `,
})
export class AccountRequestsPage {
  private readonly data = inject(AccountRequestDataSource);
  private readonly router = inject(Router);
  private readonly drawer = inject(DrawerService);
  protected readonly session = inject(SessionService);
  protected readonly launcher = inject(NewAccountLauncher);

  protected readonly state = urlState({ view: null });
  protected readonly result = loadable(() => this.data.list());
  protected readonly policy = toSignal(this.data.policy().pipe(catchError(() => of(undefined))));

  protected readonly policyLabels = ACCOUNT_POLICY_LABELS;
  protected readonly formatDate = formatDate;
  protected readonly relativeTime = relativeTime;

  protected readonly canActivate = computed(() => this.session.can('Platform.Customers.ActivateWithoutApproval'));
  protected readonly canSetPolicy = computed(() => this.session.can('Platform.Config.Manage') && !this.session.readOnly());

  private readonly all = computed(() => this.result.value() ?? []);
  private readonly match: Record<View, (v: AccountRequestView) => boolean> = {
    waiting: (v) => v.request.status === 'pending',
    delegated: (v) => v.request.route === 'delegated',
    approved: (v) => v.request.status === 'approved' && v.request.route === 'approval',
    rejected: (v) => v.request.status === 'rejected',
    mine: (v) => v.request.requestedById === this.session.actor().id,
    all: () => true,
  };
  protected readonly tabs = computed(() => {
    const labels: Record<View, string> = { waiting: 'Waiting for approval', delegated: 'Delegated activations', approved: 'Approved', rejected: 'Rejected', mine: 'Mine', all: 'All' };
    return (Object.keys(labels) as View[]).map((id) => ({ id, label: labels[id], count: this.all().filter(this.match[id]).length }));
  });
  protected readonly rows = computed(() => this.all().filter(this.match[(this.state().view as View) ?? 'waiting'] ?? this.match.waiting));

  protected readonly columns: ColumnDef<AccountRequestView>[] = [
    { key: 'account', header: 'Account', mobile: 'title', sort: (v) => v.request.details.shortName },
    { key: 'status', header: 'Status', width: '190px', sort: (v) => v.request.status },
    { key: 'route', header: 'How', width: '170px', mobile: 'hidden', sort: (v) => v.request.route },
    { key: 'by', header: 'Requested by', width: '170px', sort: (v) => v.request.requestedAt },
    { key: 'decided', header: 'Decided', width: '170px', mobile: 'hidden', sort: (v) => v.request.decidedAt ?? '' },
  ];
  protected readonly rowId = (v: AccountRequestView) => v.request.id;
  protected readonly orgLabel = (v: AccountRequestView) => (v.organisationStatus ? ORGANISATION_STATUS_LABELS[v.organisationStatus] : '');
  protected readonly routeLabel = (v: AccountRequestView) => ACCOUNT_ROUTE_LABELS[v.request.route];
  protected readonly tone = (v: AccountRequestView) => REQUEST_TONE(v.request);
  protected readonly statusLabel = (v: AccountRequestView) => (v.request.route === 'delegated' ? 'Activated (delegated)' : ACCOUNT_REQUEST_STATUS_LABELS[v.request.status]);

  protected open(v: AccountRequestView): void {
    void this.router.navigate(['/platform/account-requests', v.request.id]);
  }

  protected changePolicy(p: AccountPolicySetting): void {
    policyForm(this.drawer, this.data, p);
  }
}
