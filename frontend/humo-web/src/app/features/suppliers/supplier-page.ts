import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { SupplierDataSource, SupplierDocument, docStatus } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { pageState } from '../../core/prototype/page-state';
import { SessionService } from '../../core/session/session.service';
import { RandPipe, formatDate, formatRand } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { STAGE_LABEL, STAGE_TONE, isOpenJob } from '../maintenance/job-view';
import { VETTING } from './suppliers-page';

/** A supplier's record: vetting documents, performance, jobs and money. */
@Component({
  selector: 'app-supplier-page',
  imports: [RecordHeader, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './supplier-page.html',
  styleUrl: './supplier-page.scss',
})
export class SupplierPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(SupplierDataSource);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);
  protected readonly page = pageState();

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('supplierId')!)), {
    initialValue: this.route.snapshot.paramMap.get('supplierId')!,
  });

  protected readonly result = toSignal(
    toObservable(this.id).pipe(switchMap((id) => this.data.get(id).pipe(map((d) => d ?? (false as const)), catchError(() => of(null))))),
  );
  protected readonly detail = computed(() => {
    const r = this.result();
    return r ? r : undefined;
  });

  protected readonly status = computed(() => {
    const d = this.detail();
    if (!d) return null;
    return d.supplier.status === 'on-hold' ? { label: 'On hold', tone: 'neutral' as const } : VETTING[d.compliance];
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const p = d.supplier.performance;
    return [
      { label: 'On time', value: `${p.onTimeRate}%`, tone: p.onTimeRate < 80 ? 'warning' : 'default' },
      { label: 'Invoice vs quote', value: `${p.avgVariance > 0 ? '+' : ''}${p.avgVariance}%`, tone: p.avgVariance > 3 ? 'warning' : 'default', hint: 'Average difference between invoices and approved quotes' },
      { label: 'Fixed first time', value: `${p.verifiedRate}%`, hint: 'Residents confirmed fixed on the first visit' },
      { label: 'Jobs completed', value: String(p.jobsCompleted) },
      { label: 'Spend (12 mo.)', value: formatRand(d.spend12m, { compact: true }) },
    ];
  });

  protected readonly openJobs = computed(() => (this.detail()?.jobs ?? []).filter((j) => isOpenJob(j.job)));
  protected readonly pastJobs = computed(() => (this.detail()?.jobs ?? []).filter((j) => !isOpenJob(j.job)).slice(0, 8));

  protected readonly formatDate = formatDate;
  protected readonly stageLabel = STAGE_LABEL;
  protected readonly stageTone = STAGE_TONE;

  protected docState(d: SupplierDocument) {
    const s = docStatus(d);
    const days = d.expires ? Math.round((new Date(d.expires).getTime() - Date.now()) / 86_400_000) : null;
    switch (s) {
      case 'missing':
        return { label: 'Not on file', tone: 'danger' as const, note: 'Request it before the next work order' };
      case 'expired':
        return { label: 'Expired', tone: 'danger' as const, note: `Expired ${-days!} days ago` };
      case 'expiring':
        return { label: 'Expiring', tone: 'warning' as const, note: `Expires in ${days} days` };
      default:
        return { label: 'Valid', tone: 'success' as const, note: d.expires ? `Valid until ${formatDate(d.expires)}` : 'Does not expire' };
    }
  }

  protected request(d: SupplierDocument): void {
    const s = this.detail()?.supplier;
    if (!s) return;
    this.data.requestDocument(s.id, d.type).subscribe({
      next: () => this.feedback.success(`Requested an updated ${d.type} from ${s.contactName} (${s.email})`),
      error: () => this.feedback.error('The request didn’t send. Try again.'),
    });
  }
}
