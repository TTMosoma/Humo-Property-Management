import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, filter, of, switchMap } from 'rxjs';
import { BillingDataSource, LEVY_METHOD_LABELS, LevyDataSource, LevyMethod, LevyRollProposal, LevySetting, SchemeBillingStatus, periodLabel } from '../../../domain';
import { FeatureFlags } from '../../../core/flags/feature-flags';
import { ScopeService } from '../../../core/scope/scope.service';
import { SessionService } from '../../../core/session/session.service';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { formatDate, formatRand } from '../../../ui/format/money';
import { PageHeader } from '../../../ui/page-header/page-header';
import { EmptyState } from '../../../ui/states/empty-state';
import { REASON_FIELD, openForm } from '../../shared/form-drawer';

/**
 * Levies & billing › How levies are set (D13, docs/22 §3). Per scheme: entered
 * per unit, or derived from the approved budget. A derived roll is shown as a
 * proposal (each unit's current and new levy) and applied, with a reason, from
 * the next billing run.
 */
@Component({
  selector: 'app-levies-page',
  imports: [PageHeader, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Levies & billing" title="How levies are set" subtitle="Each scheme chooses: levies entered per unit, or derived from the approved budget and participation quotas." />

    @if (!enabled()) {
      <div class="surface"><ui-empty-state kind="first-use" title="Not switched on for your agency yet" message="The levy model is being rolled out. Levies are entered per unit, as before." /></div>
    } @else {
      <section class="surface panel">
        <label class="field">
          <span class="f-label">Scheme</span>
          <select (change)="schemeId.set($any($event.target).value)">
            @for (s of statuses(); track s.scheme.id) {
              <option [value]="s.scheme.id" [selected]="s.scheme.id === schemeId()">{{ s.scheme.name }}</option>
            }
          </select>
        </label>
        @if (setting(); as st) {
          <div class="method">
            <div>
              <span class="label-caps">Levies are</span>
              <strong>{{ methodLabel[st.method] }}</strong>
              <span class="muted">{{ st.updatedBy ? 'Set by ' + st.updatedBy + ', ' + date(st.updatedAt!) : 'The default.' }}</span>
            </div>
            @if (canEdit()) {
              <button type="button" class="btn btn-secondary btn-sm" (click)="changeMethod(st)">Change</button>
            }
          </div>
          @if (st.applied; as a) {
            <p class="muted">Last applied: the {{ a.year }} budget roll, {{ a.units }} units changed, from {{ label(a.fromPeriod) }} ({{ a.by }}, {{ date(a.at) }}).</p>
          }
        }
      </section>

      @if (setting()?.method === 'manual') {
        <section class="surface panel"><p class="muted">Each unit’s monthly levy is entered on the unit (Portfolio › Units). Switch to “Derived from the approved budget” to propose levies from the budget instead.</p></section>
      } @else if (setting()?.method === 'budget') {
        @if (proposal(); as p) {
          <section class="surface panel">
            <h2 class="section-title">Proposed levy roll · {{ p.budgetYear }} budget</h2>
            <div class="facts">
              <div><span class="label-caps">Budgeted levies</span><strong>{{ rand(p.annualLevies) }} a year</strong><span class="muted">{{ rand(p.budgetMonthly) }} a month</span></div>
              <div><span class="label-caps">Monthly roll</span><strong>{{ rand(p.currentRoll) }} → {{ rand(p.proposedRoll) }}</strong><span class="muted">Rounding to the cent: {{ rand(p.roundingDifference) }}</span></div>
              <div><span class="label-caps">From</span><strong>{{ label(p.fromPeriod) }}</strong><span class="muted">The next billing run</span></div>
              <div><span class="label-caps">Units changing</span><strong>{{ changing(p) }} of {{ p.rows.length }}</strong></div>
            </div>
            @if (p.blocked) {
              <p class="banner warn">{{ p.blocked }}</p>
            }
            <table class="table">
              <thead><tr><th>Unit</th><th class="end">Quota</th><th class="end">Share</th><th class="end">Current</th><th class="end">Proposed</th><th class="end">Change</th></tr></thead>
              <tbody>
                @for (r of p.rows; track r.unitId) {
                  <tr>
                    <td><strong>{{ r.unitNumber }}</strong> <span class="muted">{{ r.accountNo }}</span></td>
                    <td class="end">{{ r.quota }}</td>
                    <td class="end">{{ pct(r.share) }}</td>
                    <td class="end">{{ rand(r.current) }}</td>
                    <td class="end">{{ rand(r.proposed) }}</td>
                    <td class="end" [class.up]="r.change > 0" [class.down]="r.change < 0">{{ r.change === 0 ? '—' : (r.change > 0 ? '+' : '') + rand(r.change) }}</td>
                  </tr>
                }
              </tbody>
            </table>
            @if (canEdit()) {
              <div class="actions">
                <button type="button" class="btn btn-primary" [disabled]="!!p.blocked || !changing(p)" (click)="apply(p)">Apply from {{ label(p.fromPeriod) }}</button>
              </div>
            }
            <p class="muted small">Levy = annual budgeted levies × the unit’s share of the scheme’s quotas ÷ 12, to the cent. The billing run still flags each changed levy for confirmation.</p>
          </section>
        } @else {
          <section class="surface panel"><p class="muted">This scheme has no approved budget with levies income yet. Approve the budget at the AGM (Finance › Budgets); then the levy roll can be proposed here.</p></section>
        }
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { display: flex; flex-direction: column; gap: var(--s-3); padding: var(--s-4) var(--s-5); }
    .field { display: flex; flex-direction: column; gap: 4px; max-width: 360px; }
    .f-label { font-size: var(--fs-sm); font-weight: var(--fw-medium); }
    select { min-height: 34px; font: inherit; }
    .method { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); }
    .method > div, .facts > div { display: flex; flex-direction: column; gap: 2px; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--s-3); }
    .muted { margin: 0; color: var(--c-text-muted); font-size: var(--fs-sm); }
    .small { font-size: var(--fs-xs); }
    .banner { margin: 0; padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); border-left: 3px solid var(--c-warning); background: var(--c-warning-soft); }
    .table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .table th, .table td { padding: 6px var(--s-2); text-align: left; border-bottom: 1px solid var(--c-border); }
    .end { text-align: right !important; }
    .up { color: var(--c-warning); }
    .down { color: var(--c-success); }
    .actions { display: flex; gap: var(--s-2); }
  `,
})
export class LeviesPage {
  private readonly data = inject(LevyDataSource);
  private readonly billing = inject(BillingDataSource);
  private readonly scope = inject(ScopeService);
  private readonly flags = inject(FeatureFlags);
  private readonly session = inject(SessionService);
  private readonly drawer = inject(DrawerService);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly enabled = computed(() => this.flags.on('levy-model') && this.session.can('Billing.View'));
  protected readonly canEdit = computed(() => this.session.can('Billing.Run') && !this.session.readOnly());

  protected readonly statuses = toSignal(
    toObservable(computed(() => this.scope.effectiveIds())).pipe(switchMap((ids) => this.billing.status(ids).pipe(catchError(() => of([] as SchemeBillingStatus[]))))),
    { initialValue: [] as SchemeBillingStatus[] },
  );
  protected readonly schemeId = linkedSignal(() => this.query.get('scheme') ?? this.statuses()[0]?.scheme.id ?? '');
  private readonly scheme$ = toObservable(this.schemeId).pipe(filter((id) => !!id));
  protected readonly setting = toSignal(this.scheme$.pipe(switchMap((id) => this.data.setting(id).pipe(catchError(() => of(undefined))))));
  protected readonly proposal = toSignal(this.scheme$.pipe(switchMap((id) => this.data.proposal(id).pipe(catchError(() => of(undefined))))));

  protected readonly methodLabel = LEVY_METHOD_LABELS;
  protected readonly rand = formatRand;
  protected readonly date = formatDate;
  protected readonly label = (p: string) => periodLabel(p);
  protected readonly pct = (share: number) => `${(share * 100).toFixed(2)}%`;
  protected readonly changing = (p: LevyRollProposal) => p.rows.filter((r) => Math.abs(r.change) >= 0.005).length;

  protected changeMethod(st: LevySetting): void {
    const next: LevyMethod = st.method === 'manual' ? 'budget' : 'manual';
    openForm(this.drawer, {
      eyebrow: this.statuses().find((s) => s.scheme.id === st.schemeId)?.scheme.name ?? '',
      title: next === 'budget' ? 'Derive levies from the budget' : 'Enter levies per unit',
      intro:
        next === 'budget'
          ? 'Levies will be proposed from the approved budget and participation quotas. Nothing changes until someone applies a levy roll; unit levies can’t be edited by hand meanwhile.'
          : 'Each unit keeps its current levy and can be edited on the unit again. Nothing is recalculated.',
      fields: [REASON_FIELD],
      submitLabel: next === 'budget' ? 'Use the budget' : 'Enter per unit',
      submit: (v) => this.data.setMethod(st.schemeId, next, v['reason'], st.version),
      success: () => `Levies are now ${LEVY_METHOD_LABELS[next].toLowerCase()}.`,
      failure: 'It wasn’t changed',
    });
  }

  protected apply(p: LevyRollProposal): void {
    const st = this.setting();
    if (!st) return;
    openForm(this.drawer, {
      eyebrow: `${p.budgetYear} budget`,
      title: `Apply the levy roll from ${periodLabel(p.fromPeriod)}`,
      intro: `${this.changing(p)} units’ levies change; the monthly roll goes from ${formatRand(p.currentRoll)} to ${formatRand(p.proposedRoll)}. The ${periodLabel(p.fromPeriod)} billing run uses the new levies and asks for each change to be confirmed.`,
      fields: [REASON_FIELD],
      submitLabel: 'Apply levy roll',
      submit: (v) => this.data.apply(p.schemeId, p.budgetId, v['reason'], st.version),
      success: (n) => `Applied: ${n} levies changed from ${periodLabel(p.fromPeriod)}.`,
      failure: 'The levy roll wasn’t applied',
    });
  }
}
