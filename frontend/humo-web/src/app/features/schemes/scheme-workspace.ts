import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, filter, map, of, startWith } from 'rxjs';
import { SCHEME_STATUS_LABELS, Scheme, SchemeDataSource, SchemeHealth, SchemeStatus } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { STATUS_ACTION, editSchemeForm, nextStatuses, schemeStatusForm } from './scheme-forms';
import { AttentionService } from '../../core/attention/attention.service';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { formatDate, formatRand } from '../../ui/format/money';
import { SchemeArt } from '../../ui/illustration/scheme-art';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { ChainLink } from '../../ui/record/relationship-chain';
import { RouteTab, RouteTabs } from '../../ui/record/route-tabs';
import { RATING, collectionTone } from './scheme-view';

/**
 * The scheme workspace: the Record page pattern (P1) applied to a scheme.
 * Header (identity, health, key facts, relationships, actions) + tabs, with
 * each tab reusing the portfolio-wide feature pre-scoped to this scheme.
 */
@Component({
  selector: 'app-scheme-workspace',
  imports: [RecordHeader, SchemeArt, RouteTabs, RouterOutlet, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (scheme(); as s) {
      @if (scope.isBrowsing(s.id)) {
        <p class="browse-banner" role="note">You’re browsing a scheme outside your assignment: read-only. Changes are refused, and need someone assigned to {{ s.name }}.</p>
      }
      @if (!childIsRecord()) {
      <ui-record-header
        [eyebrow]="s.type + ' · ' + s.suburb + ', ' + s.city"
        [title]="s.name"
        [status]="status()"
        [facts]="facts()"
        [chain]="chain()"
      >
        <ui-scheme-art recordArt [seed]="s.id" [type]="s.type" />
        <ng-container recordActions>
        @if (canManage() && !session.readOnly()) {
          <button type="button" class="btn btn-secondary" (click)="edit()"><ion-icon name="create-outline" aria-hidden="true" /> Edit</button>
          @for (next of nextStatuses(); track next) {
            <button type="button" class="btn btn-ghost" (click)="changeStatus(next)">{{ s.status === 'archived' ? 'Restore' : s.status === 'closed' && next === 'active' ? 'Reopen' : statusAction[next] }}</button>
          }
        }
        @if (scope.canChangeScope() && s.status !== 'archived') {
          <button
            type="button"
            class="btn"
            [class.btn-secondary]="!scoped()"
            [class.btn-scoped]="scoped()"
            (click)="toggleScope()"
            [attr.aria-pressed]="scoped()"
          >
            <ion-icon [name]="scoped() ? 'checkmark-outline' : 'funnel-outline'" aria-hidden="true" />
            {{ scoped() ? 'Working on this scheme' : 'Work on this scheme' }}
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-icon"
            (click)="scope.togglePin(s.id)"
            [attr.aria-label]="scope.isPinned(s.id) ? 'Unpin from sidebar' : 'Pin to sidebar'"
            [attr.aria-pressed]="scope.isPinned(s.id)"
            [attr.title]="scope.isPinned(s.id) ? 'Unpin from sidebar' : 'Pin to sidebar'"
          >
            <ion-icon [name]="scope.isPinned(s.id) ? 'star' : 'star-outline'" aria-hidden="true" />
          </button>
        }
        </ng-container>
      </ui-record-header>

      <ui-route-tabs label="Scheme sections" [base]="'/schemes/' + s.id" [tabs]="tabs()" />
      }
      <router-outlet />
    }
  `,
  styles: `
    .browse-banner { margin: 0 0 var(--s-3); padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); border-left: 3px solid var(--c-warning); background: var(--c-warning-soft); border-radius: var(--r); }
    :host { display: block; }
    .btn-scoped { color: var(--c-accent-strong); background: var(--c-accent-soft); border-color: var(--c-accent); }
  `,
})
export class SchemeWorkspace {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(SchemeDataSource);
  private readonly attention = inject(AttentionService);
  protected readonly session = inject(SessionService);
  protected readonly scope = inject(ScopeService);

  private readonly resolved = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme)), {
    initialValue: this.route.snapshot.data['scheme'] as Scheme,
  });
  /** Live: edits and status changes show straight away (the resolver only checked access). */
  protected readonly scheme = computed(() => this.scope.findScheme(this.resolved()?.id) ?? this.resolved());

  private readonly drawer = inject(DrawerService);
  protected readonly canManage = computed(() => this.session.can('Schemes.Manage'));
  protected readonly lifecycle = computed(() => {
    const s = this.scheme();
    return s && s.status !== 'active' ? { label: SCHEME_STATUS_LABELS[s.status], tone: s.status === 'onboarding' || s.status === 'prospect' ? ('info' as const) : ('neutral' as const) } : null;
  });
  protected readonly nextStatuses = computed(() => (this.scheme() ? nextStatuses(this.scheme()!) : []));
  protected readonly statusAction = STATUS_ACTION;

  protected edit(): void {
    const s = this.scheme();
    if (s) editSchemeForm(this.drawer, this.data, s);
  }

  protected changeStatus(status: SchemeStatus): void {
    const s = this.scheme();
    if (s) schemeStatusForm(this.drawer, this.data, s, status);
  }

  private readonly allHealth = toSignal(this.data.health().pipe(catchError(() => of([] as SchemeHealth[]))), {
    initialValue: [] as SchemeHealth[],
  });
  private readonly health = computed(() => this.allHealth().find((h) => h.schemeId === this.scheme()?.id));

  private readonly router = inject(Router);

  /** Units and accounts are records with their own header; the scheme header steps aside. */
  protected readonly childIsRecord = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      // The child's snapshot is only set once activation finishes, hence the optional chaining.
      map(() => !!this.route.firstChild?.snapshot?.data?.['record']),
    ),
    { initialValue: false },
  );

  protected readonly scoped = computed(() => this.scope.scopeId() === this.scheme()?.id);

  /** Lifecycle first (it changes what can be done here), then health. */
  protected readonly status = computed(() => {
    const h = this.health();
    return this.lifecycle() ?? (h ? RATING[h.rating] : null);
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const s = this.scheme();
    const h = this.health();
    if (!s) return [];
    const facts: KeyFact[] = [{ label: 'Units', value: String(s.unitCount) }];
    if (h) {
      facts.push(
        { label: 'Collections (3 mo.)', value: `${h.collectionRate}%`, tone: collectionTone(h.collectionRate) === 'success' ? 'default' : collectionTone(h.collectionRate) },
        { label: 'Arrears', value: formatRand(h.arrears, { compact: true }), tone: h.accounts90Plus > 2 ? 'danger' : 'default', hint: `${h.accounts90Plus} accounts over 90 days` },
        { label: 'Open jobs', value: h.overdueJobs ? `${h.openJobs} · ${h.overdueJobs} overdue` : String(h.openJobs), tone: h.overdueJobs ? 'warning' : 'default' },
        { label: 'Next meeting', value: h.nextMeeting ? formatDate(h.nextMeeting.at, true) : 'None set', hint: h.nextMeeting?.type },
      );
    }
    return facts;
  });

  protected readonly chain = computed<ChainLink[]>(() => {
    const s = this.scheme();
    const agency = this.session.organisation();
    if (!s) return [];
    return [
      { kind: 'Agency', label: agency?.shortName ?? 'Agency' },
      { kind: 'Scheme', label: `${s.name} (${s.code})` },
    ];
  });

  protected readonly tabs = computed<RouteTab[]>(() => {
    const id = this.scheme()?.id ?? '';
    const open = this.attention.openForScheme(id);
    const count = (pred: (t: string) => boolean) => open.filter((w) => pred(w.type)).length;
    const staff = this.session.isStaff();
    const tabs: RouteTab[] = [
      { label: 'Overview', path: 'overview', count: open.length },
      { label: 'Units', path: 'units' },
      { label: 'People', path: 'people' },
      { label: 'Finance', path: 'finance', count: count((t) => ['receipt-allocation', 'debtor-follow-up', 'invoice-approval', 'payment-batch-approval', 'billing-run-approval'].includes(t)) },
      { label: 'Maintenance', path: 'maintenance', count: count((t) => t.startsWith('maintenance') || t === 'quote-approval') },
      { label: 'Suppliers', path: 'suppliers' },
      { label: 'Documents', path: 'documents' },
      { label: 'Communications', path: 'communications' },
      { label: 'Meetings', path: 'meetings', count: count((t) => t === 'meeting-action') },
      { label: 'Compliance', path: 'compliance', count: count((t) => t === 'compliance-due' || t === 'document-expiry') },
      { label: 'Reports', path: 'reports' },
    ];
    return staff ? tabs : tabs.filter((t) => !['units', 'people', 'communications'].includes(t.path));
  });

  /** Visiting a scheme never silently changes scope; this button does. */
  protected toggleScope(): void {
    this.scope.setScope(this.scoped() ? null : (this.scheme()?.id ?? null));
  }
}
