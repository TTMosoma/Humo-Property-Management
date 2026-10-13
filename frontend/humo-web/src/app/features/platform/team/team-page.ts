import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { HumoTeamDataSource, HumoTeamMember, IDENTITY_STATUS_LABELS, PendingHumoGrant, ROLE_LABELS, RoleAssignment, isSoleSystemAdmin, soleAdminConfirmableFrom } from '../../../domain';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { loadable } from '../../../core/data/loadable';
import { StepUpService } from '../../../core/security/step-up.service';
import { SessionService } from '../../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../../ui/data-table/data-table';
import { urlState } from '../../../ui/data-table/url-state';
import { ViewTabs } from '../../../ui/data-table/view-tabs';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { relativeTime } from '../../../ui/format/relative-time';
import { PageHeader } from '../../../ui/page-header/page-header';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill, Tone } from '../../../ui/status-pill/status-pill';
import { declineForm, inviteMemberForm } from './team-forms';

export const MEMBER_TONE: Record<string, Tone> = { invited: 'info', active: 'success', suspended: 'warning', deactivated: 'neutral' };

/**
 * Platform › Humo team: Humo's own staff, their roles and the customers they
 * look after. Everyone at Humo can see it; only System Administrators change it.
 */
@Component({
  selector: 'app-team-page',
  imports: [PageHeader, ViewTabs, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Platform" title="Humo team" subtitle="Humo’s own staff, across every Humo product. Only System Administrators change roles and access; every change is verified and recorded.">
      <a class="btn btn-ghost" routerLink="/platform/audit"><ion-icon name="document-lock-outline" aria-hidden="true" /> Audit log</a>
      @if (canManage()) {
        <button type="button" class="btn btn-primary" (click)="invite()"><ion-icon name="person-add-outline" aria-hidden="true" /> Invite to the team</button>
      }
    </ui-page-header>

    @if (mustSwitch()) {
      <p class="hint surface">You’re working as {{ currentRole() }}. Switch to your System Administrator role (your name, top right) to change the team or approve requests.</p>
    }
    @for (g of pending.value() ?? []; track g.id) {
      <div class="pending surface">
        <ion-icon name="shield-checkmark-outline" aria-hidden="true" />
        <div class="p-text">
          <strong>{{ g.requestedBy }} asks to make {{ g.identityName }} {{ roleLabel(g) }}.</strong>
          <span class="muted">{{ g.reason }} · {{ relativeTime(g.requestedAt) }}</span>
        </div>
        @if (canManage() && g.requestedById !== me() && g.identityId !== me()) {
          <div class="p-act">
            <button type="button" class="btn btn-ghost btn-sm" (click)="decline(g)">Decline</button>
            <button type="button" class="btn btn-primary btn-sm" (click)="approve(g)">Approve</button>
          </div>
        } @else if (canManage() && g.requestedById === me() && sole()) {
          <!-- Sole-administrator safeguard: their own request, after the cooling-off period. -->
          <div class="p-act">
            <span class="muted">{{ ready(g) ? 'You’re the only System Administrator: you can confirm it.' : 'You’re the only System Administrator: you can confirm it from ' + confirmableFrom(g) + '. The Humo team has been told.' }}</span>
            <button type="button" class="btn btn-ghost btn-sm" (click)="decline(g)">Withdraw</button>
            <button type="button" class="btn btn-primary btn-sm" (click)="approve(g)" [disabled]="!ready(g)">Confirm</button>
          </div>
        } @else {
          <span class="muted">{{ mustSwitch() && g.requestedById !== me() ? 'Switch to your System Administrator role to decide' : 'Waiting for another System Administrator' }}</span>
        }
      </div>
    }

    <ui-view-tabs label="Team views" [tabs]="tabs()" [active]="state().view ?? 'current'" (activeChange)="state.update((s) => ({ ...s, view: $event }))" />

    @if (result.loading()) {
      <ui-skeleton [count]="6" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the Humo team" (retry)="result.retry()" /></div>
    } @else if (!rows().length) {
      <div class="surface"><ui-empty-state title="No one here" message="No one in this view." /></div>
    } @else {
      <ui-data-table caption="Humo team" [rows]="rows()" [columns]="columns" [rowId]="rowId" (rowClick)="open($event)">
        <ng-template uiCell="person" let-m>
          <div class="person">
            <span class="avatar">{{ m.identity.initials }}</span>
            <span>
              <span class="name">{{ m.identity.name }}@if (m.identity.id === me()) {<span class="you">You</span>}</span>
              <span class="muted block">{{ m.identity.title ? m.identity.title + ' · ' : '' }}{{ m.identity.email }}</span>
            </span>
          </div>
        </ng-template>
        <ng-template uiCell="roles" let-m>
          @for (r of m.roles; track r.id) {
            <div>{{ roleName(r) }} <span class="muted">· {{ r.label }}</span></div>
          } @empty {
            <span class="muted">{{ m.pending ? 'Waiting for approval' : 'No role' }}</span>
          }
          @if (m.canImpersonate) {
            <ui-status-pill label="Can impersonate" tone="warning" />
          }
        </ng-template>
        <ng-template uiCell="customers" let-m>{{ m.customers.length || '—' }}</ng-template>
        <ng-template uiCell="status" let-m>
          <ui-status-pill [label]="statusLabel(m)" [tone]="tone(m)" />
          @if (m.lastActiveAt) {
            <div class="muted">Active {{ relativeTime(m.lastActiveAt) }}</div>
          }
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .hint { margin: 0; padding: var(--s-3) var(--s-5); border-left: 3px solid var(--c-info); }
    .pending { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); padding: var(--s-3) var(--s-5); border-left: 3px solid var(--c-warning); }
    .pending > ion-icon { font-size: 22px; color: var(--c-warning); }
    .p-text { display: flex; flex: 1; flex-direction: column; min-width: 220px; }
    .p-act { display: flex; gap: var(--s-2); }
    .person { display: flex; align-items: center; gap: var(--s-3); }
    .avatar { display: grid; flex: none; place-items: center; width: 36px; height: 36px; font-size: var(--fs-sm); font-weight: var(--fw-medium); color: var(--c-on-primary, #fff); background: var(--c-primary); border-radius: 50%; }
    .name { font-weight: var(--fw-medium); }
    .you { margin-left: var(--s-2); padding: 0 6px; font-size: var(--fs-xs); background: var(--c-surface-sunken); border-radius: var(--r-pill); }
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .block { display: block; }
  `,
})
export class TeamPage {
  private readonly router = inject(Router);
  private readonly data = inject(HumoTeamDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly stepUp = inject(StepUpService);
  private readonly session = inject(SessionService);

  protected readonly state = urlState({ view: 'current' });
  protected readonly result = loadable(() => this.data.list());
  protected readonly pending = loadable(() => this.data.pending());
  private readonly all = computed(() => this.result.value() ?? []);
  private readonly current = (m: HumoTeamMember) => m.identity.status !== 'deactivated';
  protected readonly tabs = computed(() => [
    { id: 'current', label: 'Team', count: this.all().filter(this.current).length },
    { id: 'invited', label: 'Invited', count: this.all().filter((m) => m.identity.status === 'invited').length },
    { id: 'suspended', label: 'Suspended', count: this.all().filter((m) => m.identity.status === 'suspended').length },
    { id: 'former', label: 'Former', count: this.all().filter((m) => !this.current(m)).length },
  ]);
  protected readonly rows = computed(() => {
    const v = this.state().view ?? 'current';
    return this.all()
      .filter((m) => (v === 'current' ? this.current(m) : v === 'former' ? !this.current(m) : m.identity.status === v))
      .sort((a, b) => a.identity.name.localeCompare(b.identity.name));
  });
  protected readonly columns: ColumnDef<HumoTeamMember>[] = [
    { key: 'person', header: 'Person', mobile: 'title', sort: (m) => m.identity.name },
    { key: 'roles', header: 'Roles', width: '32%' },
    { key: 'customers', header: 'Customers', align: 'end', width: '110px', sort: (m) => m.customers.length },
    { key: 'status', header: 'Status', width: '160px', sort: (m) => m.identity.status },
  ];
  protected readonly rowId = (m: HumoTeamMember) => m.identity.id;
  protected readonly roleName = (r: RoleAssignment) => ROLE_LABELS[r.role];
  protected readonly statusLabel = (m: HumoTeamMember) => IDENTITY_STATUS_LABELS[m.identity.status];
  protected readonly relativeTime = relativeTime;
  protected readonly tone = (m: HumoTeamMember) => MEMBER_TONE[m.identity.status];
  protected readonly roleLabel = (g: PendingHumoGrant) => ROLE_LABELS[g.role];
  protected readonly me = computed(() => this.session.actor().id);
  protected readonly currentRole = computed(() => ROLE_LABELS[this.session.assignment().role]);
  /** A System Administrator working in another of their roles: they switch to change the team. */
  protected readonly mustSwitch = computed(() => !this.session.can('Platform.ManageHumoRoles') && this.session.actorCan('Platform.ManageHumoRoles'));
  protected readonly canManage = computed(() => this.session.can('Platform.ManageHumoRoles') && !this.session.readOnly());
  /** Sole-administrator safeguard (docs/16 §2a): only while there's exactly one active System Administrator. */
  protected readonly sole = computed(() => isSoleSystemAdmin((this.result.value() ?? []).map((m) => m.identity), this.me()));
  protected readonly ready = (g: PendingHumoGrant) => Date.now() >= soleAdminConfirmableFrom(g).getTime();
  protected readonly confirmableFrom = (g: PendingHumoGrant) => soleAdminConfirmableFrom(g).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });

  protected open(m: HumoTeamMember): void {
    void this.router.navigate(['/platform/team', m.identity.id]);
  }

  protected invite(): void {
    inviteMemberForm(this.drawer, this.data, this.router);
  }

  protected approve(g: PendingHumoGrant): void {
    this.stepUp.guard({ action: 'change-humo-team', detail: `Approve ${g.identityName} as ${ROLE_LABELS[g.role]}` }, () => this.data.act(g.identityId, { type: 'approve-grant', grantId: g.id })).subscribe({
      next: () => this.feedback.success(`${g.identityName} is now ${ROLE_LABELS[g.role]}.`),
      error: (e) => this.feedback.error(e?.fieldErrors?.grantId ?? e?.message ?? 'It wasn’t approved.'),
    });
  }

  protected decline(g: PendingHumoGrant): void {
    declineForm(this.drawer, this.data, g);
  }
}
