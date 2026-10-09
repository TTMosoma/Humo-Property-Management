import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map, of } from 'rxjs';
import { BUDGET_STATUS_LABELS, BudgetDataSource, BudgetLineView, BudgetView, MeetingDataSource } from '../../../domain';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { loadable } from '../../../core/data/loadable';
import { ScopeService } from '../../../core/scope/scope.service';
import { SessionService } from '../../../core/session/session.service';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { RandPipe, formatDate, formatRand } from '../../../ui/format/money';
import { KeyFact, RecordHeader } from '../../../ui/record/record-header';
import { ChainLink } from '../../../ui/record/relationship-chain';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { links } from '../../accounts/account-view';
import { scheduleMeetingForm } from '../../governance/meeting-forms';
import { lineForm, proposeForm } from './budget-forms';
import { BUDGET_TONE } from './budget-view';

/**
 * One scheme's budget for one year: each line's budget to date against what
 * Humo PM has recorded (levies billed, invoices paid, invoices approved but not
 * yet paid), and — while it's a draft — editing it and putting it to the AGM.
 */
@Component({
  selector: 'app-budget-page',
  imports: [RecordHeader, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this budget" (retry)="result.retry()" /></div>
    } @else if (result.value() === false) {
      <div class="surface">
        <ui-empty-state illustration="not-found" title="We couldn’t find that budget">
          <a class="btn btn-primary" routerLink="/finance/budgets">Budgets</a>
        </ui-empty-state>
      </div>
    } @else {
      @let v = view()!;
      @let b = v.budget;
      <ui-record-header [eyebrow]="'Budget · ' + b.year" [title]="v.scheme.name" [subtitle]="formatDate(b.from) + ' to ' + formatDate(b.to)" [status]="status()" [facts]="facts()" [chain]="chain()">
        @if (canManage() && b.status === 'draft') {
          <ng-container recordActions>
            <button type="button" class="btn btn-secondary" (click)="addLine()"><ion-icon name="add-outline" aria-hidden="true" /> Add a line</button>
            <button type="button" class="btn btn-primary" (click)="propose()"><ion-icon name="people-outline" aria-hidden="true" /> Put it to the AGM</button>
          </ng-container>
        }
      </ui-record-header>

      @switch (b.status) {
        @case ('draft') {
          <p class="banner surface">A draft: change the lines as needed, then put it to the AGM. The owners approve it by resolution.</p>
        }
        @case ('proposed') {
          <p class="banner surface info">
            On the agenda of <a [routerLink]="['/governance/meetings', b.agm!.meetingId]">{{ b.agm!.meetingRef }}</a>. When the meeting passes a resolution on it, the budget is approved.
          </p>
        }
        @case ('approved') {
          <p class="banner surface ok">
            Approved {{ formatDate(b.approved!.at) }} ·
            @if (b.approved!.meetingId) {
              <a [routerLink]="['/governance/meetings', b.approved!.meetingId]">{{ b.approved!.resolutionRef }}</a>
            } @else {
              {{ b.approved!.resolutionRef }}
            }
          </p>
        }
      }

      @if (v.elapsed > 0 && chartLines().length) {
        <section class="surface panel">
          <h2 class="section-title">Spending to date against budget</h2>
          <p class="muted">
            {{ pctElapsed() }}% of the year has gone. Each bar is what’s been paid (dark) and approved but unpaid (light), against the budget to date (the marker); the percentage counts both.
            @if (b.broughtForward) {
              Spending up to {{ formatDate(b.broughtForward.to) }} was imported from the previous system when {{ v.scheme.name }} moved to Humo Property Management.
            }
          </p>
          <ul class="compare" aria-label="Spending against budget by category">
            @for (l of chartLines(); track l.line.category) {
              <li>
                <span class="cat">{{ l.line.category }}</span>
                <span class="track" [attr.aria-label]="l.line.category + ': ' + money(l.actual ?? 0) + ' paid of ' + money(l.toDate) + ' budget to date'">
                  <span class="paid" [class.over]="isOver(l)" [style.width.%]="w(l.actual ?? 0)"></span>
                  <span class="committed" [style.width.%]="w(l.committed)"></span>
                  <span class="mark" [style.left.%]="w(l.toDate)"></span>
                </span>
                <span class="num" [class.over]="isOver(l)">{{ pctOf(l) }}%</span>
              </li>
            }
          </ul>
        </section>
      }

      @for (group of groups(); track group.kind) {
        <section class="surface panel">
          <h2 class="section-title">{{ group.title }}</h2>
          <div class="table-wrap">
            <table class="lines">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" class="n">For the year</th>
                  @if (v.elapsed > 0) {
                    <th scope="col" class="n">Budget to date</th>
                    <th scope="col" class="n">Actual</th>
                    @if (group.kind === 'expense') {
                      <th scope="col" class="n">Committed</th>
                    }
                    <th scope="col" class="n">Variance</th>
                  }
                  @if (editable()) {
                    <th scope="col"><span class="sr-only">Actions</span></th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (l of group.lines; track l.line.category) {
                  <tr>
                    <th scope="row">{{ l.line.category }}</th>
                    <td class="n">{{ l.line.annual | rand: 'whole' }}</td>
                    @if (v.elapsed > 0) {
                      <td class="n">{{ l.toDate | rand: 'whole' }}</td>
                      <td class="n">
                        @if (l.actual === null) {
                          <span class="muted" title="Humo Property Management doesn’t record this category yet">Not tracked</span>
                        } @else {
                          {{ l.actual | rand: 'whole' }}
                        }
                      </td>
                      @if (group.kind === 'expense') {
                        <td class="n">{{ l.committed ? (l.committed | rand: 'whole') : '—' }}</td>
                      }
                      <td class="n" [class.over]="isBad(l)" [class.good]="isGood(l)">{{ l.variance === null ? '—' : signed(l.variance) }}</td>
                    }
                    @if (editable()) {
                      <td class="act">
                        <button type="button" class="btn btn-ghost btn-sm" (click)="editLine(l)" [attr.aria-label]="'Edit ' + l.line.category">Edit</button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="removeLine(l)" [attr.aria-label]="'Remove ' + l.line.category">Remove</button>
                      </td>
                    }
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td class="n">{{ group.total | rand: 'whole' }}</td>
                  @if (v.elapsed > 0) {
                    <td class="n">{{ group.toDate | rand: 'whole' }}</td>
                    <td class="n">{{ group.actual | rand: 'whole' }}</td>
                    @if (group.kind === 'expense') {
                      <td class="n">{{ group.committed | rand: 'whole' }}</td>
                    }
                    <td class="n"></td>
                  }
                  @if (editable()) {
                    <td></td>
                  }
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      }

      <section class="surface panel">
        <h2 class="section-title">The year’s result</h2>
        <p>
          Budgeted income {{ v.totals.income | rand: 'whole' }} less expenses {{ v.totals.expense | rand: 'whole' }}:
          <strong [class.over]="v.totals.surplus < 0">{{ v.totals.surplus < 0 ? 'a deficit of ' + money(-v.totals.surplus) : 'a surplus of ' + money(v.totals.surplus) }}</strong>
          @if (v.totals.surplus < 0) {
            — the levies won’t cover the expenses. Raise the levy or plan to draw on reserves.
          } @else {
            towards the reserve fund.
          }
        </p>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .banner { margin: 0; padding: var(--s-3) var(--s-5); }
    .banner.info { border-left: 3px solid var(--c-info); }
    .banner.ok { border-left: 3px solid var(--c-success); }
    .table-wrap { overflow-x: auto; }
    .lines { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .lines th, .lines td { padding: var(--s-2) var(--s-3); text-align: left; border-bottom: 1px solid var(--c-border); white-space: nowrap; }
    .lines thead th { font-size: var(--fs-xs); font-weight: var(--fw-medium); color: var(--c-text-muted); }
    .lines tbody th { font-weight: var(--fw-regular); white-space: normal; }
    .lines tfoot th, .lines tfoot td { font-weight: var(--fw-medium); border-bottom: none; }
    .n { text-align: right !important; font-variant-numeric: tabular-nums; }
    .act { text-align: right; }
    .over { color: var(--c-danger); }
    .good { color: var(--c-success); }
    .compare { display: flex; flex-direction: column; gap: var(--s-2); margin: var(--s-3) 0 0; padding: 0; list-style: none; }
    .compare li { display: grid; grid-template-columns: 180px minmax(0, 1fr) 48px; gap: var(--s-3); align-items: center; font-size: var(--fs-sm); }
    .cat { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .track { position: relative; display: flex; height: 12px; background: var(--c-surface-sunken); border-radius: var(--r-pill); }
    .paid { background: var(--c-primary); border-radius: var(--r-pill) 0 0 var(--r-pill); }
    .paid.over { background: var(--c-danger); }
    .committed { background: var(--c-primary); opacity: 0.35; }
    .mark { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--c-text); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    @media (max-width: 700px) { .compare li { grid-template-columns: 110px minmax(0, 1fr) 40px; } }
  `,
})
export class BudgetPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(BudgetDataSource);
  private readonly meetings = inject(MeetingDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly scope = inject(ScopeService);
  private readonly session = inject(SessionService);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('budgetId')!)), { initialValue: this.route.snapshot.paramMap.get('budgetId')! });
  /** undefined = loading; false = not found. */
  protected readonly result = loadable(() => this.data.get(this.id()).pipe(map((d) => d ?? (false as const))));
  protected readonly view = computed<BudgetView | undefined>(() => this.result.value() || undefined);

  /** This scheme's AGMs whose agenda is still open. */
  private readonly agms = loadable(() => {
    const s = this.view()?.scheme.id;
    return s ? this.meetings.list([s]).pipe(map((p) => p.items.map((x) => x.meeting).filter((m) => m.type === 'agm' && m.stage === 'draft'))) : of([]);
  });

  protected readonly formatDate = formatDate;
  protected readonly money = (n: number) => formatRand(n, { cents: false });
  protected readonly canManage = computed(() => this.session.can('Budgets.Manage') && this.session.hasFeature('budgets') && !this.session.readOnly());
  protected readonly editable = computed(() => this.canManage() && this.view()?.budget.status === 'draft');
  protected readonly status = computed(() => {
    const s = this.view()?.budget.status;
    return s ? { label: BUDGET_STATUS_LABELS[s], tone: BUDGET_TONE[s] } : null;
  });
  protected readonly pctElapsed = computed(() => Math.round((this.view()?.elapsed ?? 0) * 100));

  protected readonly facts = computed<KeyFact[]>(() => {
    const v = this.view();
    if (!v) return [];
    const t = v.totals;
    const facts: KeyFact[] = [
      { label: 'Income', value: formatRand(t.income, { compact: true }), hint: 'for the year' },
      { label: 'Expenses', value: formatRand(t.expense, { compact: true }), hint: 'for the year' },
      { label: t.surplus < 0 ? 'Deficit' : 'Surplus', value: formatRand(Math.abs(t.surplus), { compact: true }), tone: t.surplus < 0 ? 'danger' : 'success' },
    ];
    if (v.elapsed > 0) facts.push({ label: 'Over budget', value: String(v.overspent.length), hint: v.overspent.length ? 'lines, by 10% or more' : 'lines', tone: v.overspent.length ? 'warning' : 'default' });
    return facts;
  });

  protected readonly chain = computed<ChainLink[]>(() => {
    const v = this.view();
    if (!v) return [];
    return [
      { kind: 'Scheme', label: v.scheme.name, route: links.scheme(v.scheme) },
      { kind: 'Finance', label: 'Scheme finance', route: `/schemes/${v.scheme.id}/finance` },
      { kind: 'Budget', label: v.budget.year },
    ];
  });

  protected readonly groups = computed(() => {
    const v = this.view();
    if (!v) return [];
    return (['income', 'expense'] as const).map((kind) => {
      const lines = v.lines.filter((l) => l.line.kind === kind);
      return {
        kind,
        title: kind === 'income' ? 'Income' : 'Expenses',
        lines,
        total: lines.reduce((n, l) => n + l.line.annual, 0),
        toDate: lines.reduce((n, l) => n + l.toDate, 0),
        actual: lines.reduce((n, l) => n + (l.actual ?? 0), 0),
        committed: lines.reduce((n, l) => n + l.committed, 0),
      };
    });
  });

  /** Expense lines Humo PM tracks, biggest first. */
  protected readonly chartLines = computed(() =>
    (this.view()?.lines ?? []).filter((l) => l.line.kind === 'expense' && l.actual !== null && l.toDate > 0).sort((a, b) => b.toDate - a.toDate),
  );
  /** The scale: the largest of budget to date and paid + committed, across lines. */
  private readonly scale = computed(() => Math.max(1, ...this.chartLines().map((l) => Math.max(l.toDate, (l.actual ?? 0) + l.committed))));
  protected w(n: number): number {
    return (n / this.scale()) * 100;
  }
  protected pctOf(l: BudgetLineView): number {
    return l.toDate ? Math.round((((l.actual ?? 0) + l.committed) / l.toDate) * 100) : 0;
  }
  protected isOver(l: BudgetLineView): boolean {
    return this.view()!.overspent.includes(l.line.category);
  }
  /** Over on expenses, or short on income. */
  protected isBad(l: BudgetLineView): boolean {
    if (l.variance === null) return false;
    return l.line.kind === 'expense' ? this.isOver(l) : l.variance < -0.1 * l.toDate;
  }
  protected isGood(l: BudgetLineView): boolean {
    return l.variance !== null && (l.line.kind === 'expense' ? l.variance < 0 : l.variance > 0);
  }
  protected signed(n: number): string {
    return (n > 0 ? '+' : n < 0 ? '−' : '') + formatRand(Math.abs(n), { cents: false });
  }

  // ---- Commands

  protected addLine(): void {
    lineForm(this.drawer, this.data, this.view()!);
  }

  protected editLine(l: BudgetLineView): void {
    lineForm(this.drawer, this.data, this.view()!, l.line);
  }

  protected removeLine(l: BudgetLineView): void {
    const v = this.view()!;
    this.data.act(v.budget.id, { type: 'remove-line', category: l.line.category }, v.budget.version).subscribe({
      next: () => this.feedback.success(`${l.line.category} removed`),
      error: () => this.feedback.error(`${l.line.category} wasn’t removed.`),
    });
  }

  protected propose(): void {
    const v = this.view()!;
    const agms = this.agms.value() ?? [];
    if (agms.length) {
      proposeForm(this.drawer, this.data, v, agms);
      return;
    }
    // No AGM with an open agenda: schedule one first, then come back.
    this.feedback.info(`${v.scheme.name} has no AGM with an open agenda. Schedule one, then put the budget to it.`);
    scheduleMeetingForm(this.drawer, this.meetings, this.router, this.scope.accessible().filter((s) => s.id === v.scheme.id), v.scheme.id, 'agm');
  }
}
