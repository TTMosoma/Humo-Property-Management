import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ACCOUNT_POLICY_LABELS, ACCOUNT_REQUEST_STATUS_LABELS, ACCOUNT_ROUTE_LABELS, AccountRequestDataSource, ORGANISATION_STATUS_LABELS } from '../../../domain';
import { loadable } from '../../../core/data/loadable';
import { SessionService } from '../../../core/session/session.service';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { formatDate } from '../../../ui/format/money';
import { KeyFact, RecordHeader } from '../../../ui/record/record-header';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { decisionForm } from './account-request-forms';
import { REQUEST_TONE } from './account-request-view';

/**
 * One new-account request: what was asked for, how it was (or will be)
 * decided, and what happens next. Approve and Reject show only to someone who
 * may decide, and not to the person who submitted it; the API enforces both.
 */
@Component({
  selector: 'app-account-request-page',
  imports: [RecordHeader, EmptyState, ErrorState, Skeleton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this request" (retry)="result.retry()" /></div>
    } @else if (result.value() === false) {
      <div class="surface">
        <ui-empty-state illustration="not-found" title="No such request">
          <a class="btn btn-primary" routerLink="/platform/account-requests">New accounts</a>
        </ui-empty-state>
      </div>
    } @else {
      @let v = view()!;
      @let r = v.request;
      <ui-record-header eyebrow="New account" [title]="r.details.shortName" [subtitle]="r.ref + ' · ' + r.details.name" [status]="status()" [facts]="facts()">
        @if (canDecide()) {
          <ng-container recordActions>
            <button type="button" class="btn btn-ghost danger" (click)="decide('reject')">Reject</button>
            <button type="button" class="btn btn-primary" (click)="decide('approve')">Approve</button>
          </ng-container>
        }
      </ui-record-header>

      <!-- What happens next: the organisation's lifecycle, separate from anyone's sign-in. -->
      <section class="surface panel next" [class.warn]="r.status === 'pending'" [class.bad]="r.status === 'rejected'">
        @switch (r.status) {
          @case ('pending') {
            <strong>Waiting for a System Administrator</strong>
            <p>
              No organisation exists yet, and nobody can sign in.
              @if (ownRequest() && session.can('Platform.Customers.Approve')) {
                Another System Administrator decides on a request you submitted.
              }
            </p>
          }
          @case ('rejected') {
            <strong>Rejected by {{ r.decidedBy }}, {{ formatDate(r.decidedAt!) }}</strong>
            <p>“{{ r.reason }}” No organisation was created.</p>
          }
          @default {
            <strong>{{ r.route === 'delegated' ? 'Activated by ' + r.decidedBy + ' under delegated authority' : 'Approved by ' + r.decidedBy }}, {{ formatDate(r.decidedAt!) }}</strong>
            <p>
              The customer is <strong>{{ v.organisationStatus ? orgLabels[v.organisationStatus] : 'onboarding' }}</strong>, on a 30-day trial.
              Next: invite their first administrator (Agency Administrator) from Users &amp; impersonation. Nobody at the customer can sign in until that person accepts and sets up a passkey.
            </p>
            @if (r.organisationId) {
              <a class="btn btn-secondary btn-sm" [routerLink]="['/platform/customers', r.organisationId]">Open the customer</a>
            }
          }
        }
      </section>

      <div class="grid">
        <section class="surface panel">
          <h2 class="section-title">Organisation</h2>
          <dl>
            <dt>Registered name</dt><dd>{{ r.details.name }}</dd>
            <dt>Name people use</dt><dd>{{ r.details.shortName }}</dd>
            <dt>Where</dt><dd>{{ r.details.city }}, {{ r.details.province }}</dd>
            <dt>Trial package</dt><dd>{{ r.details.packageId }}</dd>
            <dt>Account manager</dt><dd>{{ r.accountManager }}</dd>
            @if (r.details.notes) {
              <dt>Notes</dt><dd>{{ r.details.notes }}</dd>
            }
          </dl>
        </section>
        <section class="surface panel">
          <h2 class="section-title">Decision</h2>
          <dl>
            <dt>How</dt><dd>{{ routeLabels[r.route] }}</dd>
            <dt>Policy when submitted</dt><dd>{{ policyLabels[r.policy] }}</dd>
            @if (r.route === 'delegated') {
              <dt>Authority</dt><dd>Platform.Customers.ActivateWithoutApproval, granted to {{ r.requestedBy }} individually</dd>
            }
            <dt>Requested</dt><dd>{{ r.requestedBy }}, {{ formatDate(r.requestedAt) }}</dd>
            @if (r.decidedAt) {
              <dt>Decided</dt><dd>{{ r.decidedBy }}, {{ formatDate(r.decidedAt) }}</dd>
            }
          </dl>
          @if (session.can('Platform.Audit')) {
            <a routerLink="/platform/audit" [queryParams]="{ q: r.ref }">See it in the audit log</a>
          }
        </section>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { padding: var(--s-4) var(--s-5); }
    .next { display: flex; flex-direction: column; align-items: flex-start; gap: var(--s-2); border-left: 3px solid var(--c-success); }
    .next.warn { border-left-color: var(--c-warning); }
    .next.bad { border-left-color: var(--c-danger); }
    .next p { margin: 0; color: var(--c-text-2); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--s-4); }
    dl { display: grid; grid-template-columns: minmax(120px, auto) 1fr; gap: var(--s-2) var(--s-4); margin: var(--s-3) 0; font-size: var(--fs-sm); }
    dt { color: var(--c-text-muted); }
    dd { margin: 0; }
    .danger { color: var(--c-danger); }
  `,
})
export class AccountRequestPage {
  private readonly data = inject(AccountRequestDataSource);
  private readonly drawer = inject(DrawerService);
  protected readonly session = inject(SessionService);

  private readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('requestId')!)), { initialValue: '' });
  /** undefined = loading; false = not found. */
  protected readonly result = loadable(() => this.data.get(this.id()).pipe(map((v) => v ?? (false as const))));
  protected readonly view = computed(() => this.result.value() || undefined);

  protected readonly orgLabels = ORGANISATION_STATUS_LABELS;
  protected readonly routeLabels = ACCOUNT_ROUTE_LABELS;
  protected readonly policyLabels = ACCOUNT_POLICY_LABELS;
  protected readonly formatDate = formatDate;

  protected readonly ownRequest = computed(() => this.view()?.request.requestedById === this.session.actor().id);
  protected readonly canDecide = computed(() => this.view()?.request.status === 'pending' && !this.ownRequest() && this.session.can('Platform.Customers.Approve') && !this.session.readOnly());

  protected readonly status = computed(() => {
    const r = this.view()?.request;
    if (!r) return null;
    return { label: r.route === 'delegated' ? 'Activated (delegated)' : ACCOUNT_REQUEST_STATUS_LABELS[r.status], tone: REQUEST_TONE(r) };
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const v = this.view();
    if (!v) return [];
    return [
      { label: 'Requested by', value: v.request.requestedBy },
      { label: 'How', value: ACCOUNT_ROUTE_LABELS[v.request.route] },
      { label: 'Customer', value: v.organisationStatus ? ORGANISATION_STATUS_LABELS[v.organisationStatus] : 'Not created' },
      { label: 'Account manager', value: v.request.accountManager },
    ];
  });

  protected decide(decision: 'approve' | 'reject'): void {
    const v = this.view();
    if (v) decisionForm(this.drawer, this.data, v, decision);
  }
}
