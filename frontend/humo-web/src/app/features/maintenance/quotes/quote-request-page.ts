import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, concatMap, map, of, switchMap } from 'rxjs';
import { ContractorNetwork, ContractorProfile } from '../../../domain/contractor';
import { JobDataSource, JobDetail } from '../../../domain';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { pageState } from '../../../core/prototype/page-state';
import { SessionService } from '../../../core/session/session.service';
import { PageHeader } from '../../../ui/page-header/page-header';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { EndorsedBy, VerificationBadge, complianceOk } from '../../contractor-shared/contractor-ui';

const DEFAULT_REQUIREMENTS: Record<string, string[]> = {
  'Gate automation': ['Remove the damaged gate', 'Supply a replacement gate', 'Install the motor', 'Test access control'],
  Plumbing: ['Find the cause of the leak', 'Repair or replace the faulty part', 'Test and make good'],
};

/**
 * Request quotes through Humo: describe the work once, choose which of your
 * suppliers to invite, and they quote in Humo Contractor. Not a marketplace —
 * only contractors you invite see the request.
 */
@Component({
  selector: 'app-quote-request-page',
  imports: [PageHeader, VerificationBadge, EndorsedBy, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-request-page.html',
  styleUrl: './quote-request-page.scss',
})
export class QuoteRequestPage {
  private readonly jobs = inject(JobDataSource);
  private readonly network = inject(ContractorNetwork);
  private readonly feedback = inject(FeedbackService);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionService);
  protected readonly page = pageState();

  protected readonly ref = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('requestId')!)), { initialValue: '' });
  protected readonly detail = toSignal(
    toObservable(this.ref).pipe(switchMap((ref) => this.jobs.get(ref).pipe(catchError(() => of(null))))),
  );
  /** The agency's suppliers for this trade at this scheme, with their Humo profiles. */
  protected readonly candidates = toSignal(
    toObservable(computed(() => this.detail() ?? null)).pipe(
      switchMap((d) => {
        if (!d) return of([] as { supplierId: string; profile: ContractorProfile }[]);
        const linked = d.candidates.filter((s) => s.partyId && s.status === 'active');
        return this.network.profiles(linked.map((s) => s.partyId!)).pipe(
          map((profiles) => linked.map((s) => ({ supplierId: s.id, profile: profiles.find((p) => p.party.id === s.partyId)! })).filter((x) => !!x.profile)),
          catchError(() => of([])),
        );
      }),
    ),
    { initialValue: [] },
  );

  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly requirements = signal('');
  protected readonly deadline = signal(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  protected readonly chosen = signal<string[]>([]);
  protected readonly inviteEmail = signal('');
  protected readonly busy = signal(false);

  protected readonly reqList = computed(() => this.requirements().split('\n').map((x) => x.trim()).filter(Boolean));
  protected readonly valid = computed(() => this.title().trim().length > 3 && this.reqList().length > 0 && this.chosen().length > 0);
  protected readonly complianceOk = complianceOk;

  constructor() {
    effect(() => {
      const d = this.detail();
      if (!d || this.title()) return;
      this.title.set(d.job.title);
      this.description.set(d.job.description);
      this.requirements.set((DEFAULT_REQUIREMENTS[d.job.category] ?? ['Inspect and quote for the repair']).join('\n'));
    });
  }

  protected toggle(partyId: string): void {
    this.chosen.update((c) => (c.includes(partyId) ? c.filter((x) => x !== partyId) : [...c, partyId]));
  }

  protected inviteByEmail(): void {
    const email = this.inviteEmail().trim();
    if (!email) return;
    this.feedback.info(`An invitation to quote (and to create a free Humo Contractor profile) would go to ${email}. Email invites are planned.`);
    this.inviteEmail.set('');
  }

  protected send(): void {
    const d = this.detail();
    if (!d || !this.valid()) return;
    this.busy.set(true);
    this.network
      .createQuoteRequest({
        customerId: this.session.agency()?.id ?? '',
        customerName: this.session.agency()?.shortName ?? '',
        site: { name: d.scheme.name, suburb: d.scheme.suburb, city: d.scheme.city },
        source: { product: 'humo-pm', ref: d.job.ref },
        title: this.title().trim(),
        description: this.description().trim(),
        category: d.job.category,
        requirements: this.reqList(),
        photos: d.job.photos.length,
        deadline: new Date(`${this.deadline()}T17:00:00`).toISOString(),
        invite: this.chosen().map((partyId) => ({ partyId, via: 'existing-relationship' as const })),
      })
      .pipe(concatMap(() => (d.job.stage === 'reported' ? this.jobs.act(d.job.ref, { type: 'request-quotes', supplierIds: [] }) : of(undefined))))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.feedback.success(`Quote request sent to ${this.chosen().length} contractors. They’ll quote in Humo Contractor.`);
          this.router.navigate(['/maintenance', d.job.ref, 'quotes']);
        },
        error: () => {
          this.busy.set(false);
          this.feedback.error('The quote request wasn’t sent.');
        },
      });
  }

  protected setText(sig: 'title' | 'description' | 'requirements' | 'deadline' | 'inviteEmail', e: Event): void {
    this[sig].set((e.target as HTMLInputElement).value);
  }

  protected job(): JobDetail | null | undefined {
    return this.detail();
  }
}
