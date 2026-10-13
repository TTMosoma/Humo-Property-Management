import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, combineLatest, filter, of, switchMap } from 'rxjs';
import { BillingDataSource, FieldErrors, MeterDataSource, MeterEntry, MeterSheet, SchemeBillingStatus, UNUSUAL_FACTOR, describeFailure, fieldErrorsOf, parseReadingsCsv, periodLabel, todaySA } from '../../../domain';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { FeatureFlags } from '../../../core/flags/feature-flags';
import { ScopeService } from '../../../core/scope/scope.service';
import { SessionService } from '../../../core/session/session.service';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { formatRand } from '../../../ui/format/money';
import { PageHeader } from '../../../ui/page-header/page-header';
import { EmptyState } from '../../../ui/states/empty-state';
import { REASON_FIELD, openForm } from '../../shared/form-drawer';

/**
 * Levies & billing › Meter readings (docs/22 §2). One scheme, one month: the
 * last reading, this month's (typed or from a CSV), consumption and the
 * unit's usual use. Saving while the month's run is Preparing updates it.
 */
@Component({
  selector: 'app-meter-readings-page',
  imports: [PageHeader, EmptyState, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Levies & billing" title="Meter readings" subtitle="Water readings for a month. The billing run charges what each unit used at the scheme’s rate; units without a reading are estimated and flagged." />

    @if (!enabled()) {
      <div class="surface"><ui-empty-state kind="first-use" title="Not switched on for your agency yet" message="Meter readings are being rolled out. Until then, water is billed as before." /></div>
    } @else if (!waterSchemes().length) {
      <div class="surface"><ui-empty-state kind="first-use" title="No schemes recover water" message="None of the schemes you can see bill owners for water." /></div>
    } @else {
      <section class="surface panel">
        <div class="grid">
          <label class="field">
            <span class="f-label">Scheme</span>
            <select (change)="schemeId.set($any($event.target).value)">
              @for (s of waterSchemes(); track s.scheme.id) {
                <option [value]="s.scheme.id" [selected]="s.scheme.id === schemeId()">{{ s.scheme.name }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span class="f-label">Month</span>
            <select (change)="period.set($any($event.target).value)">
              @for (p of periods(); track p) {
                <option [value]="p" [selected]="p === period()">{{ label(p) }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span class="f-label">Read on</span>
            <input type="date" [value]="readOn()" (input)="readOn.set($any($event.target).value)" />
            @if (errors()['readOn']) { <span class="err">{{ errors()['readOn'] }}</span> }
          </label>
        </div>
        @if (sheet(); as s) {
          <p class="muted">
            Rate {{ rand(s.setting.ratePerKl) }} per kl{{ s.setting.updatedBy ? ' (set by ' + s.setting.updatedBy + ')' : ' (default)' }} ·
            {{ s.captured }} of {{ s.rows.length }} units read for {{ label(s.period) }}
            @if (canEdit()) { · <button type="button" class="link" (click)="changeRate(s)">Change rate</button> }
          </p>
          @if (s.runStage === 'preview') {
            <p class="banner info">The {{ label(s.period) }} run is <strong>Preparing</strong>: saving updates its water charges and meter exceptions.</p>
          } @else if (s.runStage) {
            <p class="banner warn">The {{ label(s.period) }} run has left Preparing, so readings for this month can’t change. Correct water with a journal adjustment.</p>
          }
        }
      </section>

      @if (sheet(); as s) {
        <section class="surface panel">
          <div class="head">
            <h2 class="section-title">Readings</h2>
            @if (editable()) {
              <label class="btn btn-ghost btn-sm upload">
                <ion-icon name="cloud-upload-outline" aria-hidden="true" /> Fill from CSV
                <input type="file" accept=".csv,text/csv" (change)="fromCsv($event)" />
              </label>
            }
          </div>
          @if (csvProblems().length) {
            <ul class="err">@for (p of csvProblems(); track p.row) { <li>Row {{ p.row }}: {{ p.problem }}</li> }</ul>
          }
          @if (errors()['period'] || errors()['entries'] || errors()['schemeId']) {
            <p class="err">{{ errors()['period'] || errors()['entries'] || errors()['schemeId'] }}</p>
          }
          <table class="table">
            <thead><tr><th>Unit</th><th>Last reading</th><th>This reading (kl)</th><th class="end">Used</th><th class="end">Usual</th></tr></thead>
            <tbody>
              @for (r of s.rows; track r.unitId) {
                @let typed = typedFor(r.unitNumber);
                @let used = usedFor(r.previous?.reading, typed ?? r.reading);
                <tr [class.flag]="isUnusual(used, r.usual)">
                  <td><strong>{{ r.unitNumber }}</strong> <span class="muted">{{ r.accountNo }}</span></td>
                  <td>{{ r.previous ? r.previous.reading + ' (' + label(r.previous.period) + ')' : '—' }}</td>
                  <td>
                    <input type="number" min="0" step="0.01" [disabled]="!editable()" [value]="typed ?? r.reading ?? ''" (input)="type(r.unitNumber, $any($event.target).value)" [attr.aria-label]="'Reading for unit ' + r.unitNumber" />
                    @if (errors()['unit-' + r.unitNumber]) { <div class="err">{{ errors()['unit-' + r.unitNumber] }}</div> }
                  </td>
                  <td class="end">{{ used === undefined ? '—' : used + ' kl' }}@if (isUnusual(used, r.usual)) { <span class="tag">Unusual</span> }</td>
                  <td class="end muted">{{ r.usual === undefined ? '—' : r.usual + ' kl' }}</td>
                </tr>
              }
            </tbody>
          </table>
          @if (editable()) {
            <div class="actions">
              <button type="button" class="btn btn-primary" [disabled]="busy() || !changes().length" (click)="save()">Save {{ changes().length }} reading{{ changes().length === 1 ? '' : 's' }}</button>
              @if (s.runStage === 'preview') {
                <a class="btn btn-ghost" [routerLink]="['/finance/billing']">Back to Levies & billing</a>
              }
            </div>
          }
          <p class="muted small">Used more than {{ factor }}× the unit’s usual? It’s marked here and becomes an <em>Unusual meter reading</em> exception on the run for someone to confirm.</p>
        </section>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { display: flex; flex-direction: column; gap: var(--s-3); padding: var(--s-4) var(--s-5); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s-3); }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .f-label { font-size: var(--fs-sm); font-weight: var(--fw-medium); }
    select, input { min-height: 34px; font: inherit; }
    td input { width: 120px; }
    .head { display: flex; align-items: center; justify-content: space-between; }
    .upload { position: relative; overflow: hidden; }
    .upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .muted { margin: 0; color: var(--c-text-muted); font-size: var(--fs-sm); }
    .small { font-size: var(--fs-xs); }
    .err { margin: 0; font-size: var(--fs-xs); color: var(--c-danger); }
    .banner { margin: 0; padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); border-left: 3px solid var(--c-info); background: var(--c-surface-sunken); }
    .banner.warn { border-left-color: var(--c-warning); }
    .table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .table th, .table td { padding: 6px var(--s-2); text-align: left; border-bottom: 1px solid var(--c-border); vertical-align: top; }
    .end { text-align: right !important; }
    tr.flag td { background: var(--c-warning-soft); }
    .tag { margin-left: 6px; padding: 0 6px; font-size: var(--fs-2xs); font-weight: var(--fw-semibold); color: var(--c-warning); border: 1px solid currentColor; border-radius: 999px; }
    .actions { display: flex; gap: var(--s-2); }
    .link { padding: 0; font: inherit; color: var(--c-primary-text); text-decoration: underline; background: none; border: 0; cursor: pointer; }
  `,
})
export class MeterReadingsPage {
  private readonly data = inject(MeterDataSource);
  private readonly billing = inject(BillingDataSource);
  private readonly scope = inject(ScopeService);
  private readonly flags = inject(FeatureFlags);
  private readonly session = inject(SessionService);
  private readonly feedback = inject(FeedbackService);
  private readonly drawer = inject(DrawerService);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly enabled = computed(() => this.flags.on('meter-readings') && this.session.can('Billing.View'));
  protected readonly canEdit = computed(() => this.session.can('Billing.Run') && !this.session.readOnly());

  private readonly statuses = toSignal(
    toObservable(computed(() => this.scope.effectiveIds())).pipe(switchMap((ids) => this.billing.status(ids).pipe(catchError(() => of([] as SchemeBillingStatus[]))))),
    { initialValue: [] as SchemeBillingStatus[] },
  );
  protected readonly waterSchemes = computed(() => this.statuses().filter((s) => s.recoversWater));
  protected readonly schemeId = linkedSignal(() => this.query.get('scheme') ?? this.waterSchemes()[0]?.scheme.id ?? '');
  private readonly status = computed(() => this.waterSchemes().find((s) => s.scheme.id === this.schemeId()));
  /** The month of the run being prepared, else the next month to bill. */
  protected readonly periods = computed(() => {
    const s = this.status();
    if (!s) return [];
    return [...new Set([s.current?.run.period, s.nextPeriod].filter((p): p is string => !!p))];
  });
  protected readonly period = linkedSignal(() => this.query.get('period') ?? this.periods()[0] ?? '');
  protected readonly readOn = signal(todaySA());

  protected readonly sheet = toSignal(
    combineLatest([toObservable(this.schemeId), toObservable(this.period)]).pipe(
      filter(([s, p]) => !!s && !!p),
      switchMap(([s, p]) => this.data.sheet(s, p).pipe(catchError(() => of(undefined)))),
    ),
  );
  protected readonly editable = computed(() => this.canEdit() && (!this.sheet()?.runStage || this.sheet()?.runStage === 'preview'));

  /** Readings typed (or filled from a CSV) but not saved yet, by unit number. */
  protected readonly draft = linkedSignal<{ schemeId: string; period: string }, Record<string, number>>({
    source: () => ({ schemeId: this.schemeId(), period: this.period() }),
    computation: () => ({}),
  });
  protected readonly changes = computed<MeterEntry[]>(() => {
    const saved = new Map((this.sheet()?.rows ?? []).map((r) => [r.unitNumber, r.reading]));
    return Object.entries(this.draft())
      .filter(([unit, reading]) => Number.isFinite(reading) && saved.get(unit) !== reading)
      .map(([unitNumber, reading]) => ({ unitNumber, reading }));
  });
  protected readonly errors = signal<FieldErrors>({});
  protected readonly csvProblems = signal<{ row: number; problem: string }[]>([]);
  protected readonly busy = signal(false);

  protected readonly factor = UNUSUAL_FACTOR;
  protected readonly rand = formatRand;
  protected readonly label = (p: string) => periodLabel(p);

  protected usedFor(before: number | undefined, now: number | undefined): number | undefined {
    return before === undefined || now === undefined || !Number.isFinite(now) ? undefined : Math.round((now - before) * 100) / 100;
  }

  protected isUnusual(used: number | undefined, usual: number | undefined): boolean {
    return used !== undefined && usual !== undefined && usual > 0 && used > UNUSUAL_FACTOR * usual;
  }

  protected typedFor(unitNumber: string): number | undefined {
    return unitNumber in this.draft() ? this.draft()[unitNumber] : undefined;
  }

  protected type(unitNumber: string, value: string): void {
    this.draft.update((d) => ({ ...d, [unitNumber]: value === '' ? NaN : Number(value) }));
  }

  protected fromCsv(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const { entries, problems } = parseReadingsCsv(text);
      const known = new Set((this.sheet()?.rows ?? []).map((r) => r.unitNumber.toLowerCase()));
      const unknown = entries.filter((x) => !known.has(x.unitNumber.toLowerCase()));
      this.csvProblems.set([...problems, ...unknown.map((x) => ({ row: 0, problem: `Unit ${x.unitNumber} isn’t in this scheme.` }))]);
      const byLower = new Map((this.sheet()?.rows ?? []).map((r) => [r.unitNumber.toLowerCase(), r.unitNumber]));
      this.draft.update((d) => ({ ...d, ...Object.fromEntries(entries.filter((x) => byLower.has(x.unitNumber.toLowerCase())).map((x) => [byLower.get(x.unitNumber.toLowerCase())!, x.reading])) }));
      this.feedback.info(`Filled ${entries.length - unknown.length} readings from ${file.name}. Check them, then save.`);
    });
  }

  protected save(): void {
    const list = this.changes();
    this.busy.set(true);
    this.errors.set({});
    this.data.saveReadings(this.schemeId(), this.period(), this.readOn(), list).subscribe({
      next: (n) => {
        this.busy.set(false);
        this.draft.set({});
        this.feedback.success(`Saved ${n} reading${n === 1 ? '' : 's'}.${this.sheet()?.runStage === 'preview' ? ' The run’s water charges are updated.' : ''}`);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.errors.set(fieldErrorsOf(e));
        this.feedback.error(describeFailure(e, 'The readings weren’t saved'));
      },
    });
  }

  protected changeRate(s: MeterSheet): void {
    openForm(this.drawer, {
      eyebrow: s.schemeName,
      title: 'Water rate',
      intro: 'The rand per kilolitre owners are charged. It applies to runs prepared from now on, and to a run that’s still Preparing when readings are next saved.',
      fields: [{ key: 'rate', label: 'Rate per kl (R)', type: 'number', required: true }, REASON_FIELD],
      initial: { rate: String(s.setting.ratePerKl) },
      submitLabel: 'Save rate',
      submit: (v) => this.data.setRate(s.schemeId, Number(v['rate']), v['reason'], s.setting.version),
      success: (_r, v) => `Water is now ${formatRand(Number(v['rate']))} per kl.`,
      failure: 'The rate wasn’t saved',
    });
  }
}
