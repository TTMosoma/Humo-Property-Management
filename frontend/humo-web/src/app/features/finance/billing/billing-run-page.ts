import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import {
  BillingDataSource,
  BillingEvent,
  BillingException,
  BillingLine,
  BillingRun,
  BillingRunSummary,
  DECISION_LABELS,
  EXCEPTION_LABELS,
  TimelineEvent,
  TimelineKind,
  periodLabel,
} from '../../../domain';
import { DocumentTemplatesService } from '../../../core/documents/document-templates.service';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { loadable } from '../../../core/data/loadable';
import { SessionService } from '../../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../../ui/data-table/data-table';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { RandPipe, formatDate, formatRand } from '../../../ui/format/money';
import { KeyFact, RecordHeader } from '../../../ui/record/record-header';
import { ChainLink } from '../../../ui/record/relationship-chain';
import { StageTracker } from '../../../ui/stage-tracker/stage-tracker';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { Timeline } from '../../../ui/timeline/timeline';
import { cancelRunForm, confirmStep, decideForm } from './billing-forms';
import { BILLING_STAGE_TONE, BILLING_TRACKER, CHARGE_LABELS, billingStageLabel } from './billing-view';

const EVENT_KIND: Record<BillingEvent['kind'], TimelineKind> = {
  stage: 'status',
  exception: 'status',
  approval: 'status',
  posting: 'charge',
  statements: 'statement',
  comment: 'note',
};

type Detail = BillingRunSummary & { run: BillingRun };

/**
 * A billing run (Record page P1 + Workflow tracker P3):
 * charges & exceptions → approval (in Approvals) → posted (locked) → statements sent.
 */
@Component({
  selector: 'app-billing-run-page',
  imports: [RecordHeader, StageTracker, DataTable, CellDef, Timeline, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './billing-run-page.html',
  styleUrl: './billing-run-page.scss',
})
export class BillingRunPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(BillingDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly registry = inject(DocumentTemplatesService);
  protected readonly session = inject(SessionService);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('runId')!)), { initialValue: this.route.snapshot.paramMap.get('runId')! });

  /** undefined = loading; false = not found. */
  protected readonly result = loadable(() => this.data.get(this.id()).pipe(map((d) => d ?? (false as const))));
  protected readonly detail = computed<Detail | undefined>(() => this.result.value() || undefined);

  protected readonly stages = BILLING_TRACKER;
  protected readonly formatDate = formatDate;
  protected readonly exceptionLabel = (x: BillingException) => EXCEPTION_LABELS[x.kind];
  protected readonly decisionLabel = (x: BillingException) => (x.decision ? DECISION_LABELS[x.decision] : '');
  protected readonly comment = signal('');
  protected readonly filter = signal<'all' | 'flagged' | 'excluded'>('all');

  protected readonly canRun = computed(() => this.session.can('Billing.Run') && this.session.hasFeature('billing') && !this.session.readOnly());
  protected readonly locked = computed(() => ['posted', 'sent'].includes(this.detail()?.run.stage ?? ''));
  protected readonly period = computed(() => (this.detail() ? periodLabel(this.detail()!.run.period) : ''));
  protected readonly open = computed(() => this.detail()?.openExceptions ?? 0);

  protected readonly status = computed(() => {
    const r = this.detail()?.run;
    return r ? { label: billingStageLabel(r.stage), tone: BILLING_STAGE_TONE[r.stage] } : null;
  });

  /** Total vs last month: a big swing is worth a second look before approval. */
  protected readonly change = computed(() => {
    const d = this.detail();
    if (!d?.run.previousTotal) return null;
    const diff = d.total - d.run.previousTotal;
    const pct = (diff / d.run.previousTotal) * 100;
    return { diff, pct, large: Math.abs(pct) >= 10 };
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const ch = this.change();
    return [
      {
        label: 'Total',
        value: formatRand(d.total),
        hint: ch ? `${ch.diff >= 0 ? '+' : '−'}${formatRand(Math.abs(ch.diff))} (${ch.pct >= 0 ? '+' : ''}${ch.pct.toFixed(1)}%) vs last month` : undefined,
        tone: ch?.large ? 'warning' : 'default',
      },
      { label: 'Accounts', value: String(d.accounts), hint: this.excludedCount() ? `${this.excludedCount()} left out` : undefined },
      { label: 'Exceptions', value: d.run.exceptions.length ? `${d.run.exceptions.length - d.openExceptions} of ${d.run.exceptions.length} decided` : 'None', tone: d.openExceptions ? 'warning' : 'default' },
      d.run.posted ? { label: 'Posted', value: formatDate(d.run.posted.at, true), hint: d.run.posted.by } : { label: 'Prepared', value: formatDate(d.run.createdAt, true), hint: d.run.createdBy },
    ];
  });

  protected readonly chain = computed<ChainLink[]>(() => {
    const d = this.detail();
    if (!d) return [];
    return [
      { kind: 'Scheme', label: d.scheme.name, route: `/schemes/${d.scheme.id}` },
      { kind: 'Billing', label: 'Levies & billing', route: '/finance/billing' },
      { kind: 'Run', label: d.run.ref },
    ];
  });

  protected readonly excludedCount = computed(() => this.detail()?.run.lines.filter((l) => l.excluded).length ?? 0);
  private readonly flagged = computed(() => new Set(this.detail()?.run.exceptions.map((x) => x.accountId) ?? []));

  protected readonly lines = computed(() => {
    const lines = this.detail()?.run.lines ?? [];
    switch (this.filter()) {
      case 'flagged':
        return lines.filter((l) => this.flagged().has(l.accountId));
      case 'excluded':
        return lines.filter((l) => l.excluded);
      default:
        return lines;
    }
  });

  /** Totals by charge kind, for the summary above the lines. */
  protected readonly byKind = computed(() => {
    const totals = new Map<string, number>();
    for (const l of this.detail()?.run.lines ?? []) {
      if (l.excluded) continue;
      for (const c of l.charges) totals.set(c.kind, (totals.get(c.kind) ?? 0) + c.amount);
    }
    return (Object.keys(CHARGE_LABELS) as (keyof typeof CHARGE_LABELS)[]).filter((k) => totals.has(k)).map((k) => ({ label: CHARGE_LABELS[k], amount: Math.round(totals.get(k)! * 100) / 100 }));
  });

  protected readonly columns: ColumnDef<BillingLine>[] = [
    { key: 'unit', header: 'Unit', mobile: 'title', width: '28%', sort: (l) => l.unitNumber.padStart(6, '0') },
    { key: 'charges', header: 'Charges', mobile: 'field' },
    { key: 'total', header: 'Total', align: 'end', width: '140px', sort: (l) => l.total },
  ];
  protected readonly lineId = (l: BillingLine) => l.accountId;
  protected readonly isExcluded = (l: BillingLine) => l.excluded;
  protected readonly isFlagged = (l: BillingLine) => this.flagged().has(l.accountId);

  protected readonly statementsTemplate = computed(() => {
    const ref = this.detail()?.run.statements?.template;
    const r = ref ? this.registry.resolve(ref) : undefined;
    if (r) return `${r.template.name} v${r.version.version}`;
    const def = this.registry.defaultFor('levy-statement');
    return def ? `${def.name} (your default)` : 'your statement template';
  });

  protected readonly events = computed<TimelineEvent[]>(() =>
    (this.detail()?.run.events ?? []).map((e) => ({ id: e.id, at: e.at, kind: EVENT_KIND[e.kind], title: e.text, actor: e.by })),
  );

  // ---- Commands

  private d(): Detail {
    return this.detail()!;
  }

  protected decide(x: BillingException): void {
    decideForm(this.drawer, this.data, this.d().run, x);
  }

  protected step(step: 'send-for-approval' | 'post' | 'send-statements'): void {
    const d = this.d();
    confirmStep(this.drawer, this.data, d.run, d.total, d.accounts, step);
  }

  protected cancel(): void {
    cancelRunForm(this.drawer, this.data, this.d().run);
  }

  protected addComment(): void {
    const text = this.comment().trim();
    const r = this.detail()?.run;
    if (!text || !r) return;
    this.data.act(r.id, { type: 'comment', text }, r.version).subscribe({
      next: () => {
        this.comment.set('');
        this.feedback.success('Comment added');
      },
      error: () => this.feedback.error('Couldn’t add the comment — your text is still here.'),
    });
  }
}
