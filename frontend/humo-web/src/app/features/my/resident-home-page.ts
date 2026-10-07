import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { AccountDataSource, AccountDetail, JobDataSource, JobSummary, UnitDataSource } from '../../domain';
import { pageState } from '../../core/prototype/page-state';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { NOTIFICATIONS } from '../../mock/fixtures/notifications';
import { formatDate, formatRand } from '../../ui/format/money';
import { relativeTime } from '../../ui/format/relative-time';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { isOpenJob, residentStatus } from '../maintenance/job-view';

/**
 * Home for owners and tenants — phone-first. What do I owe, what's happening
 * with my requests, and what has the scheme told me? Three answers, no clutter.
 */
@Component({
  selector: 'app-resident-home-page',
  imports: [ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './resident-home-page.html',
  styleUrl: './resident-home-page.scss',
})
export class ResidentHomePage {
  private readonly units = inject(UnitDataSource);
  private readonly accounts = inject(AccountDataSource);
  private readonly jobs = inject(JobDataSource);
  protected readonly session = inject(SessionService);
  protected readonly scope = inject(ScopeService);
  protected readonly page = pageState();

  protected readonly isOwner = computed(() => this.session.role() === 'owner');

  private readonly result = toSignal(
    toObservable(this.session.membership).pipe(
      switchMap((m) => {
        const personId = this.session.persona().personId ?? '';
        const unit$ = m.unitLabel ? this.units.get(m.schemeIds[0], m.unitLabel.replace(/\D/g, '')) : of(undefined);
        return unit$.pipe(
          switchMap((u) =>
            combineLatest([
              this.jobs.forResident(personId, u?.unit.id),
              u && m.role === 'owner' ? this.accounts.get(u.account.id) : of(undefined),
            ]),
          ),
          map(([jobs, account]) => ({ jobs, account: account as AccountDetail | undefined, failed: false })),
          catchError(() => of({ jobs: [] as JobSummary[], account: undefined as AccountDetail | undefined, failed: true })),
        );
      }),
    ),
  );

  protected readonly loading = computed(() => this.page.status() === 'loading' || this.result() === undefined);
  protected readonly failed = computed(() => this.page.status() === 'error' || !!this.result()?.failed);
  protected readonly account = computed(() => this.result()?.account);
  protected readonly requests = computed(() => (this.result()?.jobs ?? []).filter((r) => isOpenJob(r.job) && !['verified', 'invoiced', 'paid'].includes(r.job.stage)).slice(0, 4));
  protected readonly needsAnswer = computed(() => this.requests().filter((r) => r.job.stage === 'completed').length);

  protected readonly notices = computed(() => {
    const m = this.session.membership();
    return NOTIFICATIONS.filter((n) => n.audience.includes(m.role))
      .filter((n) => n.schemeId === null || m.schemeIds.includes(n.schemeId))
      .filter((n) => !n.unitLabel || n.unitLabel === m.unitLabel)
      .slice(0, 4);
  });

  protected readonly where = computed(() => {
    const m = this.session.membership();
    return `${m.unitLabel} · ${this.scope.findScheme(m.schemeIds[0])?.name ?? ''}`;
  });

  protected readonly firstName = computed(() => this.session.persona().name.split(' ')[0]);
  protected readonly status = residentStatus;
  protected readonly formatDate = formatDate;
  protected readonly relativeTime = relativeTime;
  protected readonly rand = (n: number) => formatRand(n);
}
