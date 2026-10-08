import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of } from 'rxjs';
import { ContractorDashboard, ContractorPortal, VERIFICATION_LABEL, meetsRecommendedBar } from '../../domain/contractor';
import { loadable } from '../../core/data/loadable';
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

  protected readonly result = loadable(() => this.portal.dashboard(this.session.assignment().scope.partyId ?? '').pipe(map((d) => ({ d }))));
  protected readonly p = computed(() => this.result.value()?.d?.profile);
  protected readonly failed = this.result.failed;

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
