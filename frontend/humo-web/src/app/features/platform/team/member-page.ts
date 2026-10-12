import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map, take } from 'rxjs';
import { HumoRole, HumoTeamDataSource, HumoTeamMember, IDENTITY_STATUS_LABELS, PERMISSION_META, Permission, PlatformDataSource, ROLE_LABELS, ROLE_PERMISSIONS, RoleAssignment } from '../../../domain';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { loadable } from '../../../core/data/loadable';
import { PrototypeControls } from '../../../core/prototype/prototype-controls';
import { SessionService } from '../../../core/session/session.service';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { formatDate } from '../../../ui/format/money';
import { relativeTime } from '../../../ui/format/relative-time';
import { KeyFact, RecordHeader } from '../../../ui/record/record-header';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { customersForm, delegatedActivationForm, detailsForm, endRoleForm, grantRoleForm, impersonationForm, offboardForm, roleHelp, statusForm } from './team-forms';
import { MEMBER_TONE } from './team-page';

/** One person on the Humo team: roles, impersonation, the customers they look after, and their access. */
@Component({
  selector: 'app-member-page',
  imports: [RecordHeader, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this person" (retry)="result.retry()" /></div>
    } @else if (result.value() === false) {
      <div class="surface">
        <ui-empty-state illustration="not-found" title="They aren’t on the Humo team">
          <a class="btn btn-primary" routerLink="/platform/team">Humo team</a>
        </ui-empty-state>
      </div>
    } @else {
      @let m = view()!;
      @let i = m.identity;
      <ui-record-header eyebrow="Humo team" [title]="i.name" [subtitle]="(i.title ? i.title + ' · ' : '') + i.email" [status]="status()" [facts]="facts()">
        @if (canManage() && !self() && i.status !== 'deactivated') {
          <ng-container recordActions>
            <button type="button" class="btn btn-ghost" (click)="details()">Edit details</button>
            @if (i.status === 'suspended') {
              <button type="button" class="btn btn-secondary" (click)="setStatus('restore')">Restore access</button>
            } @else {
              <button type="button" class="btn btn-ghost" (click)="setStatus('suspend')">Suspend</button>
            }
            <button type="button" class="btn btn-ghost danger" (click)="offboard()">Offboard</button>
          </ng-container>
        }
      </ui-record-header>

      @if (mustSwitch() && !self()) {
        <p class="banner surface info">Switch to your System Administrator role (your name, top right) to change their access.</p>
      }
      @if (self()) {
        <p class="banner surface">This is you. Changes to your own access are made by another System Administrator.</p>
      }
      @if (i.status === 'invited') {
        <p class="banner surface info">
          Invited: they haven’t signed in yet. They set up a passkey on first sign-in.
          @if (prototype) {
            <button type="button" class="btn btn-ghost btn-sm" (click)="accept()" title="Prototype only">Simulate: invitation accepted</button>
          }
        </p>
      }
      @if (m.pending; as g) {
        <p class="banner surface warn">{{ g.requestedBy }} asked to make them {{ roleLabels[g.role] }} ({{ g.reason }}). It applies once another System Administrator approves it on the Humo team page.</p>
      }

      <div class="grid">
        <div class="main">
          <section class="surface panel">
            <header class="head">
              <h2 class="section-title">Humo roles</h2>
              @if (editable()) {
                <button type="button" class="btn btn-secondary btn-sm" (click)="grant()"><ion-icon name="add-outline" aria-hidden="true" /> Give a role</button>
              }
            </header>
            @for (r of m.roles; track r.id) {
              <div class="row">
                <div>
                  <strong>{{ roleLabels[r.role] }}</strong> <span class="muted">· {{ r.label }}</span>
                  <div class="muted">{{ help(r) }}</div>
                  <div class="muted">Given by {{ r.grantedBy ?? '—' }}{{ r.grantedAt ? ' · ' + formatDate(r.grantedAt) : '' }}</div>
                </div>
                @if (editable()) {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="endRole(r)">End</button>
                }
              </div>
            } @empty {
              <p class="muted">No Humo role in force.</p>
            }
            @if (m.formerRoles.length) {
              <h3 class="sub">Earlier roles</h3>
              @for (r of m.formerRoles; track r.id) {
                <div class="muted">{{ roleLabels[r.role] }} · {{ r.label }} · ended {{ formatDate(r.endedAt) }}{{ r.endedBy ? ' by ' + r.endedBy : '' }}</div>
              }
            }
          </section>

          @if (isAccountManager()) {
            <section class="surface panel">
              <header class="head">
                <h2 class="section-title">Customers they look after</h2>
                @if (editable()) {
                  <button type="button" class="btn btn-secondary btn-sm" (click)="customers()">Change</button>
                }
              </header>
              @for (c of m.customers; track c.organisationId) {
                <div class="row"><a [routerLink]="['/platform/customers', c.organisationId]">{{ c.name }}</a></div>
              } @empty {
                <p class="muted">No customers yet.</p>
              }
            </section>
          }
        </div>

        <aside class="side">
          <section class="surface panel">
            <h2 class="section-title">Impersonation</h2>
            @if (hasRole('system-admin')) {
              <p>{{ m.canImpersonate ? 'Allowed: they can view as a customer user. Every session is recorded.' : 'Not allowed. It’s granted to System Administrators individually, never by role.' }}</p>
              @if (editable()) {
                <button type="button" class="btn btn-secondary btn-sm" (click)="impersonation()">{{ m.canImpersonate ? 'Withdraw' : 'Allow impersonation' }}</button>
              }
            } @else {
              <p class="muted">Only System Administrators can be allowed to impersonate.</p>
            }
          </section>
          @if (hasRole('humo-account-manager')) {
            <section class="surface panel">
              <h2 class="section-title">Delegated account activation</h2>
              <p>
                @if (m.canActivateWithoutApproval) {
                  <strong>Granted.</strong> They activate new customer accounts themselves, without a separate approval. System Administrators are notified of each one, and it’s in the audit log.
                } @else {
                  <strong>Not granted.</strong> Their new customer accounts wait for a System Administrator’s approval.
                }
              </p>
              @if (editable()) {
                <button type="button" class="btn btn-secondary btn-sm" (click)="delegatedActivation()">{{ m.canActivateWithoutApproval ? 'Revoke' : 'Grant delegated activation' }}</button>
              }
            </section>
          }
          <section class="surface panel">
            <h2 class="section-title">What they can do</h2>
            <ul class="perms">
              @for (p of permissions(); track p.id) {
                <li [class.granted]="p.individual">{{ p.label }}@if (p.individual) {<span class="tag">Granted individually</span>}</li>
              }
            </ul>
          </section>
          <section class="surface panel">
            <h2 class="section-title">Activity</h2>
            <p class="muted">{{ m.lastActiveAt ? 'Last active ' + relativeTime(m.lastActiveAt) : 'No active sessions.' }}</p>
            <a routerLink="/platform/audit" [queryParams]="{ q: i.name }">Their changes in the audit log</a>
          </section>
        </aside>
      </div>
    }
  `,
  styleUrl: '../../finance/billing/billing-run-page.scss',
  styles: `
    .banner { margin: 0; padding: var(--s-3) var(--s-5); border-left: 3px solid var(--c-border); }
    .banner.info { border-left-color: var(--c-info); }
    .banner.warn { border-left-color: var(--c-warning); }
    .head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
    .row { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-3); padding: var(--s-2) 0; border-top: 1px solid var(--c-border); }
    .sub { margin: var(--s-3) 0 var(--s-1); font-size: var(--fs-sm); }
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .danger { color: var(--c-danger); }
    .perms { display: flex; flex-direction: column; gap: 4px; margin: var(--s-2) 0 0; padding: 0; list-style: none; font-size: var(--fs-sm); }
    .perms li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
    .perms .tag { padding: 0 6px; font-size: var(--fs-2xs); font-weight: var(--fw-semibold); color: var(--c-warning); background: var(--c-warning-soft); border-radius: 999px; }
  `,
})
export class MemberPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(HumoTeamDataSource);
  private readonly platform = inject(PlatformDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly session = inject(SessionService);
  protected readonly prototype = inject(PrototypeControls, { optional: true });

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('identityId')!)), { initialValue: this.route.snapshot.paramMap.get('identityId')! });
  /** undefined = loading; false = not found. */
  protected readonly result = loadable(() => this.data.get(this.id()).pipe(map((d) => d ?? (false as const))));
  protected readonly view = computed<HumoTeamMember | undefined>(() => this.result.value() || undefined);

  protected readonly roleLabels = ROLE_LABELS;
  protected readonly formatDate = formatDate;
  protected readonly relativeTime = relativeTime;
  protected readonly self = computed(() => this.view()?.identity.id === this.session.actor().id);
  /** A System Administrator working in another of their roles: they switch to change the team. */
  protected readonly mustSwitch = computed(() => !this.session.can('Platform.ManageHumoRoles') && this.session.actorCan('Platform.ManageHumoRoles'));
  protected readonly canManage = computed(() => this.session.can('Platform.ManageHumoRoles') && !this.session.readOnly());
  protected readonly editable = computed(() => this.canManage() && !this.self() && this.view()?.identity.status !== 'deactivated');
  protected readonly isAccountManager = computed(() => this.hasRole('humo-account-manager') || !!this.view()?.customers.length);
  protected readonly help = (r: RoleAssignment) => roleHelp(r.role as HumoRole);

  protected hasRole(role: HumoRole): boolean {
    return !!this.view()?.roles.some((r) => r.role === role);
  }

  protected readonly status = computed(() => {
    const s = this.view()?.identity.status;
    return s ? { label: IDENTITY_STATUS_LABELS[s], tone: MEMBER_TONE[s] } : null;
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const m = this.view();
    if (!m) return [];
    const since = m.identity.assignments.map((a) => a.grantedAt ?? '').filter(Boolean).sort()[0];
    return [
      { label: 'Roles', value: String(m.roles.length) },
      { label: 'Customers', value: String(m.customers.length) },
      { label: 'Impersonation', value: m.canImpersonate ? 'Allowed' : 'No', tone: m.canImpersonate ? 'warning' : 'default' },
      ...(this.hasRole('humo-account-manager') ? [{ label: 'Delegated activation', value: m.canActivateWithoutApproval ? 'Granted' : 'No', tone: (m.canActivateWithoutApproval ? 'warning' : 'default') as KeyFact['tone'] }] : []),
      { label: 'On the team since', value: since ? formatDate(since, true) : '—' },
    ];
  });

  // ---- Commands

  protected details(): void {
    detailsForm(this.drawer, this.data, this.view()!);
  }

  protected grant(): void {
    grantRoleForm(this.drawer, this.data, this.view()!);
  }

  protected endRole(r: RoleAssignment): void {
    endRoleForm(this.drawer, this.data, this.view()!, r);
  }

  protected impersonation(): void {
    impersonationForm(this.drawer, this.data, this.view()!);
  }

  protected delegatedActivation(): void {
    delegatedActivationForm(this.drawer, this.data, this.view()!);
  }

  /** Their Humo roles' permissions, plus anything granted to them individually. */
  protected readonly permissions = computed(() => {
    const m = this.view();
    if (!m) return [];
    const individual = new Set(m.roles.flatMap((r) => r.grants ?? []));
    const all = new Set<Permission>([...m.roles.flatMap((r) => ROLE_PERMISSIONS[r.role]), ...individual]);
    all.delete('Security.ManageOwn');
    return [...all].map((id) => ({ id, label: PERMISSION_META[id].label, individual: individual.has(id) }));
  });

  protected setStatus(kind: 'suspend' | 'restore'): void {
    statusForm(this.drawer, this.data, this.view()!, kind);
  }

  protected customers(): void {
    this.platform
      .customers({ pageSize: 1000 })
      .pipe(
        take(1),
        map((p) => p.items),
      )
      .subscribe((all) =>
        customersForm(
          this.drawer,
          this.data,
          this.view()!,
          [...all].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ organisationId: c.organisationId, name: c.name, accountManager: c.accountManager })),
        ),
      );
  }

  protected offboard(): void {
    this.data
      .list()
      .pipe(take(1))
      .subscribe((team) => offboardForm(this.drawer, this.data, this.view()!, team.filter((x) => x.identity.status === 'active' && x.roles.some((r) => r.role === 'humo-account-manager'))));
  }

  protected accept(): void {
    const m = this.view();
    if (!m || !this.prototype) return;
    this.prototype.acceptInvite(m.identity.id);
    this.feedback.success(`${m.identity.name} accepted the invitation and set up a passkey.`);
  }
}
