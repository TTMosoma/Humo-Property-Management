import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { AccountDataSource, ReceiptDataSource, ReceiptView, Transaction, UnitDataSource, periodLabel, periodOf, sumRands } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { AgeingBar } from '../../ui/ageing/ageing-bar';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { RandPipe, formatDate, formatRand } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { accountStatus, balanceTone, links, unitChain } from './account-view';

/**
 * Levy account (decision D2: it belongs to the unit). Job: answer
 * "why is my balance R X?" in one glance, and fix it if a payment was missed.
 */
@Component({
  selector: 'app-account-page',
  imports: [RecordHeader, AgeingBar, DataTable, CellDef, ViewTabs, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-page.html',
  styleUrl: './account-page.scss',
})
export class AccountPage {
  private readonly route = inject(ActivatedRoute);
  private readonly units = inject(UnitDataSource);
  private readonly accounts = inject(AccountDataSource);
  private readonly receipts = inject(ReceiptDataSource);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);

  private readonly key = toSignal(
    this.route.paramMap.pipe(map((p) => ({ schemeId: p.get('schemeId')!, number: p.get('unitId')! }))),
    { initialValue: { schemeId: this.route.snapshot.paramMap.get('schemeId')!, number: this.route.snapshot.paramMap.get('unitId')! } },
  );

  protected readonly summary = loadable(() => {
    const k = this.key();
    return this.units.get(k.schemeId, k.number).pipe(map((s) => s ?? (false as const)));
  });

  protected readonly detail = toSignal(
    toObservable(this.summary.value).pipe(
      switchMap((s) => (s ? this.accounts.get(s.account.id).pipe(map((d) => d ?? null), catchError(() => of(null))) : of(undefined))),
    ),
  );

  protected readonly suggestions = toSignal(
    toObservable(this.summary.value).pipe(
      switchMap((s) => (s ? this.receipts.suggestedFor(s.account.id).pipe(catchError(() => of([] as ReceiptView[]))) : of([] as ReceiptView[]))),
    ),
    { initialValue: [] as ReceiptView[] },
  );

  protected readonly period = signal<string>('all');
  protected readonly busyReceipt = signal<string | null>(null);

  protected readonly tabs = computed(() => {
    const d = this.detail();
    const periods = d ? d.statementPeriods : [];
    return [{ id: 'all', label: 'Last 6 months' }, ...periods.map((p) => ({ id: p, label: periodLabel(p, false) }))];
  });

  protected readonly rows = computed<Transaction[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const p = this.period();
    return p === 'all' ? d.transactions : d.transactions.filter((t) => periodOf(t.date) === p);
  });

  /** "Why is my balance R X?" — this month in one line. */
  protected readonly explain = computed(() => {
    const d = this.detail();
    // A new unit's account has no statements yet: nothing to explain.
    if (!d || !d.statementPeriods.length) return null;
    const current = d.statementPeriods[0];
    const lines = d.transactions.filter((t) => periodOf(t.date) === current);
    const opening = lines.length ? lines[lines.length - 1].balance - lines[lines.length - 1].amount : d.account.balance;
    const charges = sumRands(lines.filter((t) => t.amount > 0).map((t) => t.amount));
    const credits = sumRands(lines.filter((t) => t.amount < 0).map((t) => t.amount));
    return { month: periodLabel(current, false), opening, charges, credits, closing: d.account.balance, items: lines.filter((t) => t.amount > 0).reverse() };
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const a = d.account;
    const due = new Date();
    due.setDate(7);
    return [
      { label: 'Balance', value: formatRand(a.balance), tone: balanceTone(a) },
      { label: a.balance > 0 ? 'Due by' : 'Next levy', value: formatDate(due.toISOString(), true) },
      { label: 'Monthly levy', value: formatRand(d.unit.monthlyLevy) },
      { label: 'Last payment', value: d.lastPayment ? formatRand(-d.lastPayment.amount) : '—', hint: d.lastPayment ? formatDate(d.lastPayment.date) : undefined },
    ];
  });

  protected readonly chain = computed(() => {
    const s = this.summary.value();
    return s ? unitChain(s, s.account) : [];
  });

  protected readonly columns: ColumnDef<Transaction>[] = [
    { key: 'date', header: 'Date', width: '120px', mobile: 'meta' },
    { key: 'description', header: 'Description', mobile: 'title' },
    { key: 'charge', header: 'Charges', align: 'end', width: '130px' },
    { key: 'credit', header: 'Payments & credits', align: 'end', width: '160px' },
    { key: 'balance', header: 'Balance', align: 'end', width: '130px' },
  ];

  protected readonly rowId = (t: Transaction) => t.id;
  protected readonly links = links;
  protected readonly formatDate = formatDate;
  protected readonly periodLabel = periodLabel;

  protected status() {
    const d = this.detail();
    return d ? accountStatus(d.account) : null;
  }

  protected allocateHere(v: ReceiptView): void {
    const s = this.summary.value();
    if (!s) return;
    this.busyReceipt.set(v.receipt.id);
    this.receipts.allocate(v.receipt.id, [{ accountId: s.account.id, amount: v.receipt.amount }], false, v.receipt.version).subscribe({
      next: () => {
        this.busyReceipt.set(null);
        this.feedback.success(`Allocated ${formatRand(v.receipt.amount)} to ${s.account.accountNo}`, () =>
          this.receipts.unallocate(v.receipt.id).subscribe(),
        );
      },
      error: () => {
        this.busyReceipt.set(null);
        this.feedback.error('The allocation could not be saved. Nothing was changed — try again.');
      },
    });
  }

  protected sendStatement(): void {
    const d = this.detail();
    if (!d) return;
    this.feedback.info(`Prototype: the ${periodLabel(d.statementPeriods[0], false)} statement would be re-sent to ${d.holder.email}.`);
  }
}
