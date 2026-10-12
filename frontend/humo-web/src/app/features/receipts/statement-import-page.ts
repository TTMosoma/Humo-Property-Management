import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, of, switchMap } from 'rxjs';
import {
  FieldErrors,
  ReceiptDataSource,
  STATEMENT_DATE_FORMATS,
  StatementDateFormat,
  StatementImportBatch,
  StatementImportResult,
  StatementMapping,
  StatementPreview,
  describeFailure,
  fieldErrorsOf,
  parseCsv,
} from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { FeatureFlags } from '../../core/flags/feature-flags';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { formatDate, formatRand } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';

/** Common header names, to suggest a mapping the first time a bank's file is seen. */
const GUESS: Record<keyof Omit<StatementMapping, 'dateFormat'>, RegExp> = {
  date: /^(transaction )?date$|^value date$|^posting date$/i,
  amount: /^amount$|^value$/i,
  credit: /^credit|^deposits?$|^money in$/i,
  debit: /^debit|^withdrawals?$|^money out$/i,
  reference: /^reference$|^description$|^narrative$|^details$/i,
  payer: /^payer$|^depositor$|^name$|^counterparty$/i,
};

/**
 * Finance › Receipts › Import bank statement (docs/22 §1). Choose the scheme
 * and the CSV, map the columns once per trust account, preview what happens,
 * then import. Duplicates and debits are skipped; nothing is allocated here.
 */
@Component({
  selector: 'app-statement-import-page',
  imports: [PageHeader, EmptyState, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Finance › Receipts" title="Import a bank statement" subtitle="Credits on the scheme’s trust account become receipts to allocate. Duplicates and debits are skipped." />

    @if (!enabled()) {
      <div class="surface"><ui-empty-state kind="first-use" title="Not switched on for your agency yet" message="Bank-statement import is being rolled out. Receipts still arrive as before." /></div>
    } @else if (result(); as r) {
      <section class="surface panel done">
        <ion-icon name="checkmark-circle-outline" aria-hidden="true" />
        <div>
          <strong>Imported {{ r.imported }} {{ r.imported === 1 ? 'receipt' : 'receipts' }} ({{ rand(r.total) }})</strong>
          <p class="muted">{{ n(r.duplicates, 'duplicate') }} skipped · {{ n(r.debits, 'debit') }} ignored · {{ n(r.invalid, 'row') }} couldn’t be read. They’re waiting to be allocated.</p>
          <div class="actions">
            <a class="btn btn-primary btn-sm" routerLink="/finance/receipts">Allocate receipts</a>
            <button type="button" class="btn btn-ghost btn-sm" (click)="reset()">Import another file</button>
          </div>
        </div>
      </section>
    } @else {
      <section class="surface panel">
        <h2 class="section-title">1. The statement</h2>
        <div class="grid">
          <label class="field">
            <span class="f-label">Scheme (its trust account)</span>
            <select [value]="schemeId()" (change)="pickScheme($any($event.target).value)">
              @for (s of schemes(); track s.id) {
                <option [value]="s.id" [selected]="s.id === schemeId()">{{ s.name }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span class="f-label">CSV file from the bank</span>
            <input type="file" accept=".csv,text/csv" (change)="pickFile($event)" />
            @if (errors()['file']) { <span class="err">{{ errors()['file'] }}</span> }
          </label>
        </div>
      </section>

      @if (header().length) {
        <section class="surface panel">
          <h2 class="section-title">2. Columns</h2>
          <p class="muted">{{ remembered() ? 'Using the mapping remembered for this trust account. Change it if the bank’s export changed.' : 'Tell us which column is which. It’s remembered for this trust account after the import.' }}</p>
          <div class="grid">
            @for (f of fields; track f.key) {
              <label class="field">
                <span class="f-label">{{ f.label }}{{ f.optional ? ' (optional)' : '' }}</span>
                <select [value]="mapping()[f.key] ?? ''" (change)="setColumn(f.key, $any($event.target).value)">
                  <option value="">—</option>
                  @for (h of header(); track h) {
                    <option [value]="h">{{ h }}</option>
                  }
                </select>
                @if (errors()[f.key]) { <span class="err">{{ errors()[f.key] }}</span> }
              </label>
            }
            <label class="field">
              <span class="f-label">Date format</span>
              <select [value]="mapping().dateFormat" (change)="setFormat($any($event.target).value)">
                @for (d of dateFormats; track d.value) {
                  <option [value]="d.value">{{ d.label }}</option>
                }
              </select>
            </label>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="runPreview()">Preview</button>
          </div>
        </section>
      }

      @if (preview(); as p) {
        <section class="surface panel">
          <h2 class="section-title">3. Check, then import</h2>
          <div class="chips">
            <span class="chip ok">{{ n(p.receipts.length, 'new receipt') }} · {{ rand(p.total) }}</span>
            <span class="chip">{{ n(p.duplicates.length, 'duplicate') }} skipped</span>
            <span class="chip">{{ n(p.debits, 'debit') }} ignored</span>
            <span class="chip" [class.warn]="p.invalid.length">{{ n(p.invalid.length, 'row') }} can’t be read</span>
          </div>
          @if (p.receipts.length) {
            <table class="table">
              <thead><tr><th>Row</th><th>Date</th><th>Reference</th><th>Depositor</th><th class="end">Amount</th></tr></thead>
              <tbody>
                @for (l of p.receipts.slice(0, 50); track l.row) {
                  <tr><td>{{ l.row }}</td><td>{{ formatDate(l.date!) }}</td><td>{{ l.reference }}</td><td>{{ l.payer ?? '—' }}</td><td class="end">{{ rand(l.amount!) }}</td></tr>
                }
              </tbody>
            </table>
            @if (p.receipts.length > 50) { <p class="muted">And {{ p.receipts.length - 50 }} more.</p> }
          }
          @if (p.duplicates.length) {
            <h3 class="sub">Already imported (skipped)</h3>
            <ul class="muted small">
              @for (l of p.duplicates; track l.row) { <li>Row {{ l.row }}: {{ formatDate(l.date!) }} · {{ l.reference }} · {{ rand(l.amount!) }}</li> }
            </ul>
          }
          @if (p.invalid.length) {
            <h3 class="sub">Can’t be read (skipped)</h3>
            <ul class="small">
              @for (l of p.invalid; track l.row) { <li>Row {{ l.row }}: {{ l.problem }}</li> }
            </ul>
          }
          <div class="actions">
            <button type="button" class="btn btn-primary" [disabled]="busy() || !p.receipts.length" (click)="runImport()">
              Import {{ p.receipts.length }} {{ p.receipts.length === 1 ? 'receipt' : 'receipts' }}
            </button>
          </div>
        </section>
      }

      @if (recent().length) {
        <section class="surface panel">
          <h2 class="section-title">Recent imports</h2>
          <ul class="small">
            @for (b of recent(); track b.id) {
              <li>{{ formatDate(b.at) }} · {{ b.fileName }} · {{ b.bankAccount }} · {{ b.imported }} imported, {{ b.duplicates }} duplicates, {{ b.invalid }} unreadable · {{ b.by }}</li>
            }
          </ul>
        </section>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { display: flex; flex-direction: column; gap: var(--s-3); padding: var(--s-4) var(--s-5); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--s-3); }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .f-label { font-size: var(--fs-sm); font-weight: var(--fw-medium); }
    select, input[type='file'] { min-height: 36px; font: inherit; }
    .err { font-size: var(--fs-xs); color: var(--c-danger); }
    .muted { margin: 0; color: var(--c-text-muted); font-size: var(--fs-sm); }
    .small { font-size: var(--fs-sm); }
    .actions { display: flex; gap: var(--s-2); }
    .chips { display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .chip { padding: 2px var(--s-3); font-size: var(--fs-sm); background: var(--c-surface-sunken); border-radius: 999px; }
    .chip.ok { color: var(--c-success); background: var(--c-success-soft); }
    .chip.warn { color: var(--c-warning); background: var(--c-warning-soft); }
    .table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .table th, .table td { padding: 6px var(--s-2); text-align: left; border-bottom: 1px solid var(--c-border); }
    .end { text-align: right !important; }
    .sub { margin: var(--s-2) 0 0; font-size: var(--fs-sm); }
    .done { flex-direction: row; align-items: flex-start; }
    .done ion-icon { font-size: 28px; color: var(--c-success); }
  `,
})
export class StatementImportPage {
  private readonly data = inject(ReceiptDataSource);
  private readonly feedback = inject(FeedbackService);
  private readonly scope = inject(ScopeService);
  private readonly flags = inject(FeatureFlags);
  private readonly session = inject(SessionService);

  protected readonly enabled = computed(() => this.flags.on('receipt-capture') && this.session.can('Receipts.Allocate'));
  protected readonly schemes = computed(() => this.scope.accessible());
  /** The scheme chip's scheme, else the first one in scope, once the schemes have loaded. */
  protected readonly schemeId = linkedSignal(() => {
    const ids = this.scope.effectiveIds();
    return ids.length === 1 ? ids[0] : (this.scope.accessible()[0]?.id ?? '');
  });
  protected readonly fileName = signal('');
  private readonly csv = signal('');
  private readonly firstRow = signal<string[]>([]);
  protected readonly header = signal<string[]>([]);
  protected readonly mapping = signal<StatementMapping>({ date: '', dateFormat: 'yyyy-mm-dd', reference: '' });
  protected readonly remembered = signal(false);
  protected readonly preview = signal<StatementPreview | null>(null);
  protected readonly result = signal<StatementImportResult | null>(null);
  protected readonly errors = signal<FieldErrors>({});
  protected readonly busy = signal(false);

  protected readonly recent = toSignal(
    toObservable(computed(() => this.scope.accessible().map((s) => s.id))).pipe(switchMap((ids) => this.data.imports(ids).pipe(catchError(() => of([] as StatementImportBatch[]))))),
    { initialValue: [] as StatementImportBatch[] },
  );

  protected readonly fields: { key: keyof Omit<StatementMapping, 'dateFormat'>; label: string; optional?: boolean }[] = [
    { key: 'date', label: 'Date' },
    { key: 'amount', label: 'Amount (credits positive)', optional: true },
    { key: 'credit', label: 'Or: credit column', optional: true },
    { key: 'debit', label: 'Debit column', optional: true },
    { key: 'reference', label: 'Reference or description' },
    { key: 'payer', label: 'Depositor', optional: true },
  ];
  protected readonly dateFormats = STATEMENT_DATE_FORMATS;
  protected readonly formatDate = formatDate;
  protected readonly rand = formatRand;
  protected readonly n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

  protected pickScheme(id: string): void {
    this.schemeId.set(id);
    this.preview.set(null);
    if (this.header().length) this.loadMapping();
  }

  protected pickFile(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    this.preview.set(null);
    this.errors.set({});
    if (!file) return;
    file.text().then((text) => {
      const rows = parseCsv(text);
      if (rows.length < 2) {
        this.header.set([]);
        this.errors.set({ file: 'The file has no rows under the header. Export the statement as CSV with a header row.' });
        return;
      }
      this.fileName.set(file.name);
      this.csv.set(text);
      this.header.set(rows[0].map((h) => h.trim()).filter(Boolean));
      this.firstRow.set(rows[1]);
      this.loadMapping();
    });
  }

  /** The remembered mapping for this trust account, or a guess from the header names. */
  private loadMapping(): void {
    this.data
      .statementMapping(this.schemeId())
      .pipe(catchError(() => of(undefined)))
      .subscribe((saved) => {
        const fits = saved && [saved.date, saved.reference].every((c) => this.header().includes(c));
        this.remembered.set(!!fits);
        if (fits) {
          this.mapping.set(saved!);
          return;
        }
        const pick = (re: RegExp) => this.header().find((h) => re.test(h.trim()));
        const amount = pick(GUESS.amount);
        const date = pick(GUESS.date) ?? '';
        // The first date decides the format: 2026-10-07 reads as ISO; 07/10/2026 as South African day-first.
        const sample = (this.firstRow()[this.header().indexOf(date)] ?? '').trim();
        this.mapping.set({
          date,
          dateFormat: /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}/.test(sample) ? (Number(sample.split(/[/.-]/)[1]) > 12 ? 'mm/dd/yyyy' : 'dd/mm/yyyy') : 'yyyy-mm-dd',
          amount,
          credit: amount ? undefined : pick(GUESS.credit),
          debit: amount ? undefined : pick(GUESS.debit),
          reference: pick(GUESS.reference) ?? '',
          payer: pick(GUESS.payer),
        });
      });
  }

  protected setColumn(key: keyof Omit<StatementMapping, 'dateFormat'>, value: string): void {
    this.mapping.update((m) => ({ ...m, [key]: value || undefined }) as StatementMapping);
    this.preview.set(null);
  }

  protected setFormat(value: StatementDateFormat): void {
    this.mapping.update((m) => ({ ...m, dateFormat: value }));
    this.preview.set(null);
  }

  protected runPreview(): void {
    this.busy.set(true);
    this.errors.set({});
    this.data.previewStatement(this.schemeId(), this.fileName(), this.csv(), this.mapping()).subscribe({
      next: (p) => {
        this.busy.set(false);
        this.preview.set(p);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.errors.set(fieldErrorsOf(e));
      },
    });
  }

  protected runImport(): void {
    this.busy.set(true);
    this.data.importStatement(this.schemeId(), this.fileName(), this.csv(), this.mapping()).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.result.set(r);
        this.feedback.success(`Imported ${r.imported} receipts from ${this.fileName()}.`);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.errors.set(fieldErrorsOf(e));
        this.feedback.error(describeFailure(e, 'The statement wasn’t imported'));
      },
    });
  }

  protected reset(): void {
    this.result.set(null);
    this.preview.set(null);
    this.header.set([]);
    this.csv.set('');
    this.fileName.set('');
  }
}
