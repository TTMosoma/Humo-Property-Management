import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, concatMap, map, of, switchMap } from 'rxjs';
import { ContractorNetwork, ContractorProfile } from '../../../domain/contractor';
import { JobDataSource, JobDetail, saDate } from '../../../domain';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { loadable } from '../../../core/data/loadable';
import { SessionService } from '../../../core/session/session.service';
import { PageHeader } from '../../../ui/page-header/page-header';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { EndorsedBy, VerificationBadge, complianceOk } from '../../contractor-shared/contractor-ui';

const DEFAULT_REQUIREMENTS: Record<string, string[]> = {
  'Gate automation': ['Remove the damaged gate', 'Supply a replacement gate', 'Install the motor', 'Test access control'],
  Plumbing: ['Find the cause of the leak', 'Repair or replace the faulty part', 'Test and make good'],
};

/**
 * Request quotes through Humo Contractor: describe the work once, choose which of your
 * suppliers to invite, and they quote in Humo Contractor. Not a marketplace —
 * only contractors you invite see the request.
 */
@Component({
  selector: 'app-quote-request-page',
  imports: [PageHeader, VerificationBadge, EndorsedBy, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
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

  protected readonly ref = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('requestId')!)), { initialValue: '' });
  protected readonly result = loadable(() => this.jobs.get(this.ref()));
  protected readonly detail = computed(() => this.result.value());
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
  protected readonly deadline = signal(saDate(new Date(Date.now() + 14 * 86_400_000)));
  protected readonly chosen = signal<string[]>([]);
  protected readonly inviteEmail = signal('');
  /** Businesses not on Humo Contractor yet; each gets an email invitation when the request is sent. */
  protected readonly emails = signal<string[]>([]);
  protected readonly emailError = signal('');
  protected readonly busy = signal(false);

  protected readonly reqList = computed(() => this.requirements().split('\n').map((x) => x.trim()).filter(Boolean));
  protected readonly valid = computed(() => this.title().trim().length > 3 && this.reqList().length > 0 && this.chosen().length + this.emails().length > 0);
  protected readonly recipients = computed(() => this.chosen().length + this.emails().length);
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

  /** Adds the address to the request; the invitation goes out when the request is sent. */
  protected inviteByEmail(): void {
    const email = this.inviteEmail().trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.emailError.set('That isn’t an email address.');
      return;
    }
    this.emailError.set('');
    if (!this.emails().includes(email)) this.emails.update((all) => [...all, email]);
    this.inviteEmail.set('');
  }

  protected removeEmail(email: string): void {
    this.emails.update((all) => all.filter((e) => e !== email));
  }

  protected send(): void {
    const d = this.detail();
    if (!d || !this.valid()) return;
    this.busy.set(true);
    this.network
      .createQuoteRequest({
        customerId: this.session.organisation()?.id ?? '',
        customerName: this.session.organisation()?.shortName ?? '',
        site: { name: d.scheme.name, suburb: d.scheme.suburb, city: d.scheme.city },
        source: { product: 'humo-pm', ref: d.job.ref },
        title: this.title().trim(),
        description: this.description().trim(),
        category: d.job.category,
        requirements: this.reqList(),
        photos: d.job.photos.length,
        deadline: new Date(`${this.deadline()}T17:00:00`).toISOString(),
        invite: this.chosen().map((partyId) => ({ partyId, via: 'existing-relationship' as const })),
        inviteEmails: this.emails(),
      })
      .pipe(concatMap(() => (d.job.stage === 'reported' ? this.jobs.act(d.job.ref, { type: 'request-quotes', supplierIds: [] }) : of(undefined))))
      .subscribe({
        next: () => {
          this.busy.set(false);
          const n = this.recipients();
          this.feedback.success(`Quote request sent to ${n} ${n === 1 ? 'contractor' : 'contractors'}. They’ll quote in Humo Contractor.`);
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
