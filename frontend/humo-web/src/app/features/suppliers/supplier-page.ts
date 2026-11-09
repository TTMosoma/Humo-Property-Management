import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { LibraryDataSource, Supplier, SupplierDataSource, SupplierDocument, SupplierStatus, docStatus } from '../../domain';
import { bankDetailsForm, editSupplierForm, supplierStatusForm } from './supplier-forms';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { ScopeService } from '../../core/scope/scope.service';
import { ContractorNetwork } from '../../domain/contractor';
import { EndorsedBy, Reputation, VerificationBadge } from '../contractor-shared/contractor-ui';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { RandPipe, formatDate, formatRand } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { STAGE_LABEL, STAGE_TONE, isOpenJob } from '../maintenance/job-view';
import { VETTING } from './suppliers-page';
import { AttachmentsPanel } from '../library/attachments-panel';
import { uploadForm } from '../library/library-forms';

/** A supplier's record: vetting documents, performance, jobs and money. */
@Component({
  selector: 'app-supplier-page',
  imports: [AttachmentsPanel, VerificationBadge, Reputation, EndorsedBy, RecordHeader, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './supplier-page.html',
  styleUrl: './supplier-page.scss',
})
export class SupplierPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(SupplierDataSource);
  private readonly feedback = inject(FeedbackService);
  private readonly contractors = inject(ContractorNetwork);
  protected readonly session = inject(SessionService);
  private readonly drawer = inject(DrawerService);
  private readonly scope = inject(ScopeService);
  private readonly library = inject(LibraryDataSource);
  protected readonly canUpload = computed(() => this.session.can('Documents.Manage') && this.session.hasFeature('documents') && !this.session.readOnly());
  protected readonly canManage = computed(() => this.session.can('Suppliers.Manage') && !this.session.readOnly());

  protected edit(s: Supplier): void {
    editSupplierForm(this.drawer, this.data, s, this.scope.accessible());
  }

  protected setStatus(s: Supplier, status: SupplierStatus): void {
    supplierStatusForm(this.drawer, this.data, s, status);
  }

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('supplierId')!)), {
    initialValue: this.route.snapshot.paramMap.get('supplierId')!,
  });

  protected readonly result = loadable(() => {
    const id = this.id();
    return this.data.get(id).pipe(map((d) => d ?? (false as const)));
  });
  protected readonly detail = computed(() => {
    const r = this.result.value();
    return r ? r : undefined;
  });

  /** The business's Humo-wide profile (if it's on Humo Contractor). */
  protected readonly network = toSignal(
    toObservable(computed(() => this.detail()?.supplier.partyId ?? null)).pipe(
      switchMap((partyId) => (partyId ? this.contractors.profile(partyId).pipe(catchError(() => of(undefined))) : of(undefined))),
    ),
  );
  protected readonly endorsing = signal(false);
  protected readonly endorseNote = signal('');
  protected readonly endorsedByUs = computed(() => !!this.network()?.endorsements.some((e) => e.fromCustomerId === this.session.organisation()?.id));
  protected readonly canEndorse = computed(() => this.session.can('Suppliers.Manage') && (this.detail()?.supplier.performance.jobsCompleted ?? 0) > 0);

  protected endorse(): void {
    const s = this.detail()?.supplier;
    const agency = this.session.organisation();
    if (!s?.partyId || !agency) return;
    this.contractors.endorse(s.partyId, agency.id, agency.shortName, this.endorseNote().trim(), s.performance.jobsCompleted).subscribe({
      next: () => {
        this.endorsing.set(false);
        this.feedback.success(`${agency.shortName} now endorses ${s.name} on Humo. Other Humo customers will see it when comparing quotes.`);
      },
      error: () => this.feedback.error('The endorsement wasn’t saved.'),
    });
  }

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
        return { label: 'Not on file', tone: 'danger' as const, note: 'Upload it before the next work order' };
      case 'expired':
        return { label: 'Expired', tone: 'danger' as const, note: `Expired ${-days!} days ago` };
      case 'expiring':
        return { label: 'Expiring', tone: 'warning' as const, note: `Expires in ${days} days` };
      default:
        return { label: 'Valid', tone: 'success' as const, note: d.expires ? `Valid until ${formatDate(d.expires)}` : 'Does not expire' };
    }
  }

  /**
   * Bank-detail changes are the classic invoice-fraud route: step-up first, then payments are held until someone
   * else verifies the account in My work (D27).
   */
  protected changeBank(): void {
    const s = this.detail()?.supplier;
    if (s) bankDetailsForm(this.drawer, this.data, s);
  }

  /** A new vetting document: uploaded to the library, it updates the vetting record and Compliance. */
  protected uploadDoc(type: SupplierDocument['type']): void {
    const s = this.detail()?.supplier;
    if (s) uploadForm(this.drawer, this.library, { kind: 'supplier', id: s.id, label: s.name }, { category: 'vetting', supplierDoc: type });
  }

}
