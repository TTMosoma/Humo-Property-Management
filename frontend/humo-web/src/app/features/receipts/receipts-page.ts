import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, debounceTime, map, of, switchMap } from 'rxjs';
import { MatchView, ReceiptDataSource, ReceiptView, UnitDataSource, UnitSummary, sumRands } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { RandPipe, formatDate, formatRand } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { accountStatus, links } from '../accounts/account-view';

interface SplitLine {
  accountId: string;
  label: string;
  amount: number;
}

/**
 * Finance › Receipts. Job: identify each incoming payment and allocate it to
 * the right owner account — quickly, and with reasons you can trust.
 * Keyboard: ↑/↓ to move between receipts, Enter to accept the top suggestion.
 */
@Component({
  selector: 'app-receipts-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './receipts-page.html',
  styleUrl: './receipts-page.scss',
  host: { '(document:keydown)': 'onKey($event)' },
})
export class ReceiptsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly receipts = inject(ReceiptDataSource);
  private readonly units = inject(UnitDataSource);
  private readonly feedback = inject(FeedbackService);
  protected readonly scope = inject(ScopeService);

  protected readonly view = signal<'open' | 'suspense' | 'allocated'>('open');
  protected readonly selectedId = signal<string | null>(this.route.snapshot.queryParamMap.get('receipt'));
  protected readonly busy = signal(false);
  protected readonly remember = signal(true);
  protected readonly search = signal('');
  protected readonly splitting = signal(false);
  protected readonly split = signal<SplitLine[]>([]);

  protected readonly result = loadable(() => this.receipts.list(this.scope.effectiveIds()).pipe(map((p) => ({ rows: p.items }))));

  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  private readonly all = computed(() => ((this.result.value()?.rows ?? [])));

  protected readonly list = computed(() => {
    const status = this.view() === 'open' ? 'unallocated' : this.view() === 'suspense' ? 'suspense' : 'allocated';
    return this.all()
      .filter((v) => v.receipt.status === status)
      .sort((a, b) => (status === 'allocated' ? b.receipt.date.localeCompare(a.receipt.date) : a.receipt.date.localeCompare(b.receipt.date)));
  });

  protected readonly tabs = computed(() => {
    const all = this.all();
    return [
      { id: 'open', label: 'To allocate', count: all.filter((v) => v.receipt.status === 'unallocated').length },
      { id: 'suspense', label: 'Suspense', count: all.filter((v) => v.receipt.status === 'suspense').length },
      { id: 'allocated', label: 'Allocated this week', count: all.filter((v) => v.receipt.status === 'allocated').length },
    ];
  });

  protected readonly totals = computed(() => {
    const open = this.all().filter((v) => v.receipt.status === 'unallocated');
    return { count: open.length, amount: sumRands(open.map((v) => v.receipt.amount)) };
  });

  protected readonly selected = computed(() => this.all().find((v) => v.receipt.id === this.selectedId()));

  protected readonly matches = toSignal(
    toObservable(this.selectedId).pipe(
      switchMap((id) => (id ? this.receipts.matches(id).pipe(catchError(() => of([] as MatchView[]))) : of([] as MatchView[]))),
    ),
    { initialValue: [] as MatchView[] },
  );

  protected readonly searchResults = toSignal(
    toObservable(computed(() => ({ q: this.search(), scheme: this.selected()?.scheme.id }))).pipe(
      debounceTime(120),
      switchMap(({ q, scheme }) =>
        q.trim().length >= 1 && scheme
          ? this.units.search(/^\d+$/.test(q.trim()) ? q.trim() : q, [scheme], 6).pipe(catchError(() => of([] as UnitSummary[])))
          : of([] as UnitSummary[]),
      ),
    ),
    { initialValue: [] as UnitSummary[] },
  );

  protected readonly splitRemaining = computed(() => {
    const total = this.selected()?.receipt.amount ?? 0;
    return sumRands([total, ...this.split().map((l) => -(Number(l.amount) || 0))]);
  });

  protected readonly links = links;
  protected readonly formatDate = formatDate;
  protected readonly accountStatus = accountStatus;

  constructor() {
    // Keep a sensible selection: the requested receipt, else the first in the current view.
    effect(() => {
      const list = this.list();
      const id = untracked(this.selectedId);
      if (!list.some((v) => v.receipt.id === id)) {
        const requested = id ? this.all().find((v) => v.receipt.id === id) : undefined;
        if (requested) {
          untracked(() => this.view.set(requested.receipt.status === 'unallocated' ? 'open' : requested.receipt.status === 'suspense' ? 'suspense' : 'allocated'));
        } else {
          untracked(() => this.select(list[0]?.receipt.id ?? null));
        }
      }
    });
  }

  protected select(id: string | null): void {
    this.selectedId.set(id);
    this.search.set('');
    this.splitting.set(false);
    this.split.set([]);
    this.remember.set(true);
  }

  protected setView(v: string): void {
    this.view.set(v as 'open' | 'suspense' | 'allocated');
    this.select(this.list()[0]?.receipt.id ?? null);
  }

  protected confidenceTone(c: number): 'success' | 'warning' | 'neutral' {
    return c >= 75 ? 'success' : c >= 45 ? 'warning' : 'neutral';
  }

  protected isWarning(reason: string): boolean {
    return /not the owner|check|×/.test(reason);
  }

  protected allocateTo(accountId: string, label: string): void {
    const v = this.selected();
    if (!v) return;
    this.commit(v, [{ accountId, amount: v.receipt.amount }], `Allocated ${formatRand(v.receipt.amount)} to ${label}`);
  }

  protected addToSplit(s: UnitSummary): void {
    if (this.split().some((l) => l.accountId === s.account.id)) return;
    const remaining = Math.max(0, this.splitRemaining());
    this.split.update((lines) => [...lines, { accountId: s.account.id, label: `${s.scheme.code} ${s.unit.number}`, amount: remaining }]);
    this.search.set('');
  }

  protected setSplitAmount(i: number, value: string): void {
    this.split.update((lines) => lines.map((l, j) => (j === i ? { ...l, amount: Number(value) } : l)));
  }

  protected removeSplit(i: number): void {
    this.split.update((lines) => lines.filter((_, j) => j !== i));
  }

  protected confirmSplit(): void {
    const v = this.selected();
    if (!v || this.splitRemaining() !== 0) return;
    const lines = this.split().filter((l) => l.amount > 0);
    this.commit(v, lines.map((l) => ({ accountId: l.accountId, amount: l.amount })), `Split ${formatRand(v.receipt.amount)} across ${lines.length} accounts`);
  }

  protected suspense(): void {
    const v = this.selected();
    if (!v) return;
    this.busy.set(true);
    const next = this.nextId(v.receipt.id);
    this.receipts.moveToSuspense(v.receipt.id, v.receipt.version).subscribe({
      next: () => {
        this.busy.set(false);
        this.select(next);
        this.feedback.success(`Moved ${formatRand(v.receipt.amount)} to suspense`, () => this.receipts.unallocate(v.receipt.id).subscribe());
      },
      error: () => this.fail(),
    });
  }

  protected undo(v: ReceiptView): void {
    this.receipts.unallocate(v.receipt.id, v.receipt.version).subscribe({
      next: () => this.feedback.info(`${formatRand(v.receipt.amount)} is back in “To allocate”`),
      error: () => this.fail(),
    });
  }

  protected onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable], .cdk-overlay-container')) return;
    const list = this.list();
    const i = list.findIndex((v) => v.receipt.id === this.selectedId());
    if (e.key === 'ArrowDown' && i < list.length - 1) {
      e.preventDefault();
      this.select(list[i + 1].receipt.id);
    } else if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault();
      this.select(list[i - 1].receipt.id);
    } else if (e.key === 'Enter' && this.view() === 'open' && !this.splitting()) {
      const top = this.matches()[0];
      if (top && top.confidence >= 45) {
        e.preventDefault();
        this.allocateTo(top.accountId, top.summary.unit.accountNo);
      }
    }
  }

  private commit(v: ReceiptView, allocations: { accountId: string; amount: number }[], message: string): void {
    this.busy.set(true);
    const next = this.nextId(v.receipt.id);
    this.receipts.allocate(v.receipt.id, allocations, this.remember() && allocations.length === 1, v.receipt.version).subscribe({
      next: () => {
        this.busy.set(false);
        this.select(next);
        this.feedback.success(message, () => this.receipts.unallocate(v.receipt.id).subscribe());
      },
      error: () => this.fail(),
    });
  }

  private nextId(currentId: string): string | null {
    const list = this.list();
    const i = list.findIndex((v) => v.receipt.id === currentId);
    return list[i + 1]?.receipt.id ?? list[i - 1]?.receipt.id ?? null;
  }

  private fail(): void {
    this.busy.set(false);
    this.feedback.error('That didn’t save. Nothing was changed — try again.');
  }
}
