import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of } from 'rxjs';
import { ContractorDashboard, ContractorPortal, QuoteRequest, WorkOrder } from '../../domain/contractor';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { formatDate, formatRand } from '../../ui/format/money';
import { relativeTime } from '../../ui/format/relative-time';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { VerificationBadge } from '../contractor-shared/contractor-ui';

const WO_LABEL: Record<WorkOrder['status'], string> = {
  awarded: 'Awarded',
  scheduled: 'Scheduled',
  'in-progress': 'On site',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

/**
 * Humo Contractor home: what needs a response, what's on today, and how the
 * business is seen. Job-first and calm — a work tool, not a lead feed.
 * The same component lists all quote requests (/requests) and jobs (/jobs).
 */
@Component({
  selector: 'app-contractor-home-page',
  imports: [VerificationBadge, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './contractor-home-page.html',
  styleUrl: './contractor-home-page.scss',
})
export class ContractorHomePage {
  private readonly portal = inject(ContractorPortal);
  protected readonly session = inject(SessionService);
  protected readonly view = (inject(ActivatedRoute).snapshot.data['view'] as 'dashboard' | 'requests' | 'jobs') ?? 'dashboard';

  private readonly partyId = this.session.assignment().scope.partyId ?? '';
  protected readonly result = loadable(() => this.portal.dashboard(this.partyId).pipe(map((d) => ({ d }))));
  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  protected readonly d = computed(() => this.result.value()?.d);

  protected readonly today = computed(() => {
    const end = new Date();
    end.setHours(23, 59, 59);
    return (this.d()?.workOrders ?? [])
      .filter((w) => ['scheduled', 'in-progress', 'awarded'].includes(w.status))
      .sort((a, b) => (a.scheduledFor ?? '9').localeCompare(b.scheduledFor ?? '9'));
  });

  protected readonly expiring = computed(() => {
    const soon = Date.now() + 45 * 86_400_000;
    return (this.d()?.profile.documents ?? []).filter((doc) => doc.expires && new Date(doc.expires).getTime() < soon);
  });

  protected readonly woLabel = WO_LABEL;
  protected readonly time = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
  protected readonly formatDate = formatDate;
  protected readonly relativeTime = relativeTime;
  protected readonly rand = (n: number) => formatRand(n, { cents: false });

  protected daysLeft(r: QuoteRequest): number {
    return Math.max(0, Math.ceil((new Date(r.deadline).getTime() - Date.now()) / 86_400_000));
  }

  protected myStatus(r: QuoteRequest): string {
    return r.invitations.find((i) => i.partyId === this.partyId)?.status ?? 'invited';
  }

  protected quoteState(x: ContractorDashboard['submitted'][number]): { label: string; tone: string } {
    if (x.quote.status === 'accepted') return { label: 'Accepted', tone: 'good' };
    if (x.quote.status === 'not-selected') return { label: 'Not selected', tone: 'muted' };
    return x.viewed ? { label: 'Viewed by customer', tone: 'info' } : { label: 'Submitted', tone: 'muted' };
  }
}
