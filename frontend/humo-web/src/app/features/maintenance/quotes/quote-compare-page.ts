import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, combineLatest, concatMap, map, of, switchMap } from 'rxjs';
import { ContractorNetwork, ContractorProfile, ContractorQuote, LIFECYCLE_LABEL, QuoteRequestView } from '../../../domain/contractor';
import { DELEGATED_LIMIT, JobDataSource, JobDetail, JobStage, SupplierDataSource, SupplierSummary, stageIndex } from '../../../domain';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { loadable } from '../../../core/data/loadable';
import { SessionService } from '../../../core/session/session.service';
import { formatDate, formatRand } from '../../../ui/format/money';
import { relativeTime } from '../../../ui/format/relative-time';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill } from '../../../ui/status-pill/status-pill';
import { EndorsedBy, Reputation, VerificationBadge, complianceOk } from '../../contractor-shared/contractor-ui';

interface Step {
  label: string;
  state: 'done' | 'current' | 'todo';
  note?: string;
}

/**
 * Compare quotes from a Humo Contractor quote request. Humo lays the offers side by side —
 * price, reputation, compliance, proposed work, timing — and the agent decides.
 * There is no automated selection and no "best" badge from Humo.
 */
@Component({
  selector: 'app-quote-compare-page',
  imports: [VerificationBadge, Reputation, EndorsedBy, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-compare-page.html',
  styleUrl: './quote-compare-page.scss',
})
export class QuoteComparePage {
  private readonly network = inject(ContractorNetwork);
  private readonly jobs = inject(JobDataSource);
  private readonly suppliers = inject(SupplierDataSource);
  private readonly feedback = inject(FeedbackService);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionService);

  protected readonly ref = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('requestId')!)), { initialValue: '' });

  protected readonly result = loadable(() => {
    const ref = this.ref();
    return combineLatest([this.jobs.get(ref), this.network.quoteRequestFor({ product: 'humo-pm', ref })]).pipe(
      switchMap(([job, qr]) => (job ? this.suppliers.list([job.job.schemeId]) : of([] as SupplierSummary[])).pipe(map((sups) => ({ job, qr, sups })))),
    );
  });

  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  protected readonly job = computed(() => this.result.value()?.job);
  protected readonly qr = computed(() => this.result.value()?.qr);

  /** Businesses the agency already works with (a Supplier record linked to the party). */
  private readonly linkedParties = computed(() => new Set((this.result.value()?.sups ?? []).map((s) => s.supplier.partyId).filter(Boolean)));

  protected readonly canAct = computed(() => this.session.can('Maintenance.Manage'));
  protected readonly limit = DELEGATED_LIMIT;

  protected readonly offers = computed(() => {
    const v = this.qr();
    if (!v) return [];
    const lowest = Math.min(...v.quotes.filter((q) => q.status !== 'withdrawn').map((q) => q.amount));
    const fastest = Math.min(...v.quotes.map((q) => new Date(q.completeBy).getTime()));
    return v.quotes.map((q) => {
      const profile = v.profiles[q.partyId];
      const invitation = v.request.invitations.find((i) => i.partyId === q.partyId);
      const existing = this.linkedParties().has(q.partyId);
      const hours = invitation ? Math.max(1, Math.round((new Date(q.submittedAt).getTime() - new Date(invitation.invitedAt).getTime()) / 3_600_000)) : null;
      return {
        q,
        profile,
        existing,
        lowest: q.amount === lowest,
        fastest: new Date(q.completeBy).getTime() === fastest,
        responseHours: hours,
        compliant: profile ? complianceOk(profile) : false,
        disclosure: v.disclosure[q.partyId],
      };
    });
  });

  protected readonly noResponse = computed(() => {
    const v = this.qr();
    return v ? v.request.invitations.filter((i) => !v.quotes.some((q) => q.partyId === i.partyId)) : [];
  });

  protected readonly noResponseNames = computed(() => this.noResponse().map((i) => this.name(i.partyId)).join(', '));

  protected readonly accepted = computed(() => this.qr()?.quotes.find((q) => q.status === 'accepted'));

  /** The workflow, from report to invoice, in one line. */
  protected readonly steps = computed<Step[]>(() => {
    const v = this.qr();
    const job = this.job()?.job;
    if (!v || !job) return [];
    const quoted = v.quotes.length;
    const at = stageIndex(job.stage);
    const past = (s: JobStage) => at > stageIndex(s);
    const now = (s: JobStage) => job.stage === s;
    const st = (done: boolean, current: boolean): Step['state'] => (done ? 'done' : current ? 'current' : 'todo');
    const awarded = v.request.status === 'awarded';
    return [
      { label: 'Maintenance request', state: 'done', note: job.ref },
      { label: 'Contractors chosen', state: 'done', note: `${v.request.invitations.length} invited` },
      { label: 'Quote request', state: 'done', note: v.request.id },
      { label: 'Quotes', state: st(awarded, !awarded), note: `${quoted} of ${v.request.invitations.length} in` },
      { label: 'Approval', state: st(past('approval') && awarded, now('approval')), note: job.approval?.status === 'pending' ? 'With trustees' : undefined },
      { label: 'Scheduled', state: st(past('scheduled'), now('scheduled') || now('approved')) },
      { label: 'Work started', state: st(past('in-progress'), now('in-progress')) },
      { label: 'Completed', state: st(past('completed') || now('verified'), now('completed')) },
      { label: 'Invoice', state: st(past('invoiced'), now('invoiced')) },
    ];
  });

  protected readonly events = computed(() =>
    [...(this.qr()?.events ?? [])].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12),
  );

  protected readonly confirming = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly lifecycleLabel = LIFECYCLE_LABEL;
  protected readonly formatDate = formatDate;
  protected readonly relativeTime = relativeTime;
  protected readonly rand = (n: number) => formatRand(n, { cents: false });

  constructor() {
    // Opening the comparison is a lifecycle event ("Quote viewed") — contractors see it.
    effect(() => {
      const v = this.qr();
      if (v && this.canAct() && v.quotes.length) this.network.markViewed(v.request.id, v.quotes.map((q) => q.id));
    });
  }

  protected readonly name = (partyId: string): string => this.qr()?.profiles[partyId]?.party.tradingName ?? partyId;

  protected recommend(q: ContractorQuote): void {
    this.network.setRecommended(q.quoteRequestId, q.id).subscribe({ error: () => this.feedback.error('That didn’t save.') });
  }

  /**
   * Accepting a quote: start (or reuse) the supplier relationship, record the
   * chosen quote on the job (which sends it for approval), then close the request.
   */
  protected accept(q: ContractorQuote, profile: ContractorProfile): void {
    const job = this.job()?.job;
    const v = this.qr();
    if (!job || !v) return;
    this.busy.set(true);
    this.suppliers
      .linkParty({ partyId: profile.party.id, name: profile.party.tradingName, trades: [v.request.category], schemeId: job.schemeId })
      .pipe(
        concatMap((supplierId) =>
          this.jobs.act(job.ref, {
            type: 'award-network-quote', supplierId, amount: q.amount, guaranteeMonths: q.guaranteeMonths, quoteRequestId: v.request.id, compared: v.quotes.length, completeBy: q.completeBy,
          }),
        ),
        concatMap(() => this.network.accept(v.request.id, q.id)),
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.confirming.set(null);
          this.feedback.success(
            q.amount > DELEGATED_LIMIT
              ? `Accepted ${profile.party.tradingName} at ${this.rand(q.amount)} — sent to the trustees for approval. The other contractors have been told.`
              : `Accepted and approved ${profile.party.tradingName} at ${this.rand(q.amount)}. Issue the work order from the job.`,
          );
          this.router.navigate(['/maintenance', job.ref]);
        },
        error: () => {
          this.busy.set(false);
          this.feedback.error('The quote wasn’t accepted. Nothing was changed.');
        },
      });
  }

  protected message(name: string): void {
    this.feedback.info(`Messages to ${name} go through Humo, so the quote history stays in one place. (Messaging is planned.)`);
  }
}
