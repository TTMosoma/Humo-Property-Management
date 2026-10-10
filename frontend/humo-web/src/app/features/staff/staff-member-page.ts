import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { combineLatest, map } from 'rxjs';
import { ROLE_LABELS, StaffDataSource, WORK_TYPE_LABELS, WorkItem, urgencyOf } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { dueLabel, formatDate } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { ChainLink } from '../../ui/record/relationship-chain';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { coverForm } from './staff-forms';

/** One team member: their schemes, open work and what they've done lately; set or end their away cover. */
@Component({
  selector: 'app-staff-member-page',
  imports: [RecordHeader, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this person" (retry)="result.retry()" /></div>
    } @else if (!d()) {
      <div class="surface"><ui-empty-state illustration="not-found" title="Not on the team"><a class="btn btn-primary" routerLink="/staff">Staff</a></ui-empty-state></div>
    } @else {
      @let s = d()!;
      <ui-record-header [eyebrow]="roles()" [title]="s.name" [subtitle]="(s.title ?? '') + (s.title ? ' · ' : '') + s.email" [status]="status()" [facts]="facts()" [chain]="chain()">
        <ng-container recordActions>
          @if (canCover()) {
            @if (s.away) {
              <button type="button" class="btn btn-secondary" (click)="endCover()">{{ s.name.split(' ')[0] }} is back</button>
            } @else {
              <button type="button" class="btn btn-secondary" (click)="setCover()"><ion-icon name="airplane-outline" aria-hidden="true" /> Set away cover</button>
            }
          }
          @if (session.can('Users.Manage')) {
            <a class="btn btn-ghost" routerLink="/settings/users">Roles & schemes</a>
          }
        </ng-container>
      </ui-record-header>

      @if (s.away; as a) {
        <div class="away surface" role="note">
          <ion-icon name="airplane-outline" aria-hidden="true" />
          <div><strong>Away {{ formatDate(a.from, true) }} – {{ formatDate(a.to, true) }}</strong> ({{ a.reason }}). <a [routerLink]="['/staff', a.coverId]">{{ a.coverName }}</a> is covering: {{ a.movedIds.length }} item{{ a.movedIds.length === 1 ? '' : 's' }} moved, and new work for their schemes goes to {{ a.coverName.split(' ')[0] }}. Set by {{ a.setBy }}.</div>
        </div>
      }

      <div class="grid">
        <section class="surface panel">
          <h2 class="section-title">Open work ({{ s.openWork.length }})</h2>
          <ul class="work">
            @for (w of s.openWork; track w.id) {
              <li [class.late]="late(w)">
                <a [routerLink]="link(w)">{{ w.title }}</a>
                <span class="muted">{{ typeLabel(w) }} · {{ schemeName(w.schemeId) }} · {{ dueLabel(w.dueAt) }}</span>
              </li>
            } @empty {
              <li class="muted">Nothing open.</li>
            }
          </ul>
        </section>
        <aside class="side">
          <section class="surface panel">
            <h2 class="section-title">Schemes</h2>
            @if (s.allSchemes) {
              <p class="muted">All the agency’s schemes ({{ s.schemes.length }}).</p>
            }
            <ul class="schemes">
              @for (x of s.schemes.slice(0, s.allSchemes ? 0 : 50); track x.id) {
                <li><a [routerLink]="['/schemes', x.id, 'overview']">{{ x.name }}</a> <span class="muted">{{ x.unitCount }} units</span></li>
              }
            </ul>
          </section>
          <section class="surface panel">
            <h2 class="section-title">Done in the last 14 days</h2>
            <ul class="work">
              @for (w of s.doneRecently; track w.id) {
                <li><span>{{ w.title }}</span> <span class="muted">{{ typeLabel(w) }} · {{ formatDate(w.decidedAt, true) }}</span></li>
              } @empty {
                <li class="muted">Nothing recorded.</li>
              }
            </ul>
          </section>
        </aside>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .away { display: flex; gap: var(--s-3); align-items: flex-start; padding: var(--s-3) var(--s-4); font-size: var(--fs-sm); background: var(--c-warning-soft); }
    .away ion-icon { flex: none; margin-top: 2px; font-size: 18px; color: var(--c-warning); }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: var(--s-4); align-items: start; }
    .side { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .work, .schemes { margin: 0; padding: 0; list-style: none; }
    .work li, .schemes li { display: flex; flex-direction: column; gap: 2px; padding: var(--s-2) 0; border-top: 1px solid var(--c-border); font-size: var(--fs-sm); }
    .schemes li { flex-direction: row; justify-content: space-between; }
    .work li.late .muted { color: var(--c-danger); }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class StaffMemberPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(StaffDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('staffId')!)), { initialValue: this.route.snapshot.paramMap.get('staffId')! });
  protected readonly result = loadable(() => combineLatest([this.data.get(this.id()), this.data.list()]).pipe(map(([detail, team]) => ({ detail, team }))));
  protected readonly d = computed(() => this.result.value()?.detail);

  protected readonly roles = computed(() => (this.d()?.roles ?? []).map((r) => ROLE_LABELS[r]).join(' · '));
  protected readonly status = computed(() => (this.d()?.away ? { label: 'Away', tone: 'warning' as const } : { label: 'In', tone: 'success' as const }));
  protected readonly facts = computed<KeyFact[]>(() => {
    const s = this.d();
    if (!s) return [];
    return [
      { label: 'Open Tasks', value: String(s.openTasks), hint: s.overdueTasks ? `${s.overdueTasks} overdue` : undefined, tone: s.overdueTasks ? 'danger' : 'default' },
      { label: 'Messages', value: String(s.openMessages) },
      { label: 'Approvals they can decide', value: String(s.approvalsWaiting) },
      { label: 'Schemes', value: s.allSchemes ? 'All' : String(s.schemes.length) },
    ];
  });
  protected readonly chain = computed<ChainLink[]>(() => [{ kind: 'Portfolio', label: 'Staff', route: '/staff' }, { kind: 'Person', label: this.d()?.name ?? '' }]);
  protected readonly canCover = computed(() => !this.session.readOnly() && (this.session.can('Users.Manage') || this.session.identity().staffId === this.id()));

  protected readonly formatDate = formatDate;
  protected readonly dueLabel = dueLabel;
  protected readonly typeLabel = (w: WorkItem) => WORK_TYPE_LABELS[w.type];
  protected readonly late = (w: WorkItem) => urgencyOf(w) === 'overdue';
  protected readonly link = (w: WorkItem) => (w.kind === 'approval' ? '/approvals' : w.route.split('?')[0]);
  protected schemeName(id: string): string {
    return this.d()?.schemes.find((s) => s.id === id)?.name ?? '';
  }

  protected setCover(): void {
    coverForm(this.drawer, this.data, this.d()!, this.result.value()!.team);
  }

  protected endCover(): void {
    this.data.endCover(this.id()).subscribe({ next: () => this.feedback.success('Welcome back: open work has moved back.'), error: () => this.feedback.error('The cover wasn’t ended.') });
  }
}
