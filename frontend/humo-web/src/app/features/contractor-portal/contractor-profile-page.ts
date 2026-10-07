import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of } from 'rxjs';
import { ContractorDashboard, ContractorPortal, VERIFICATION_LABEL, meetsRecommendedBar } from '../../domain/contractor';
import { pageState } from '../../core/prototype/page-state';
import { SessionService } from '../../core/session/session.service';
import { formatDate, formatRand } from '../../ui/format/money';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { Reputation, VerificationBadge } from '../contractor-shared/contractor-ui';

/**
 * The business profile: what Humo customers see when comparing quotes.
 * Reputation and endorsements are earned from customers — the contractor
 * can't edit them. Editing services, areas and documents comes later.
 */
@Component({
  selector: 'app-contractor-profile-page',
  imports: [VerificationBadge, Reputation, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './contractor-profile-page.html',
  styleUrl: './contractor-profile-page.scss',
})
export class ContractorProfilePage {
  private readonly portal = inject(ContractorPortal);
  protected readonly session = inject(SessionService);
  protected readonly page = pageState();

  private readonly result = toSignal(
    this.portal.dashboard(this.session.membership().partyId ?? '').pipe(
      map((d) => ({ d, failed: false })),
      catchError(() => of({ d: undefined as ContractorDashboard | undefined, failed: true })),
    ),
  );
  protected readonly p = computed(() => this.result()?.d?.profile);
  protected readonly failed = computed(() => this.page.status() === 'error' || !!this.result()?.failed);

  /** The three states, and what each one means — no fake checks. */
  protected readonly levels = computed(() => {
    const p = this.p();
    const order = ['listed', 'verified', 'recommended'] as const;
    const at = p ? order.indexOf(p.verification.level) : 0;
    return [
      { id: 'listed', label: VERIFICATION_LABEL.listed, text: 'You created a business profile.', done: at >= 0 },
      { id: 'verified', label: VERIFICATION_LABEL.verified, text: 'Humo checked your registration, compliance documents and insurance.', done: at >= 1 },
      {
        id: 'recommended', label: VERIFICATION_LABEL.recommended,
        text: 'Verified, with a sustained record: 4.6★+, 20+ completed jobs, 90%+ on time and 5+ customer endorsements. Humo confirms it.',
        done: at >= 2,
        eligible: p ? meetsRecommendedBar(p.verification, p.reputation) : false,
      },
    ];
  });

  protected readonly formatDate = formatDate;
  protected readonly rand = (n: number) => formatRand(n, { compact: true, cents: false });
}
