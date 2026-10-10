import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { AccountDataSource, AccountDetail, AppNotification, JobDataSource, NotificationDataSource, UnitDataSource } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
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
  private readonly notifications = inject(NotificationDataSource);
  protected readonly session = inject(SessionService);
  protected readonly scope = inject(ScopeService);

  protected readonly isOwner = computed(() => this.session.role() === 'owner');

  /** The unit this assignment is for, its open requests and (for owners) the levy account. */
  protected readonly result = loadable(() => {
    const a = this.session.assignment();
    const personId = this.session.identity().personId ?? '';
    const unit$ = a.scope.unitId ? this.units.byId(a.scope.unitId) : of(undefined);
    return unit$.pipe(
      switchMap((u) =>
        combineLatest([this.jobs.forResident(personId, u?.unit.id), u && a.role === 'owner' ? this.accounts.get(u.account.id) : of(undefined)]).pipe(
          map(([jobs, account]) => ({ unit: u, jobs, account: account as AccountDetail | undefined })),
        ),
      ),
    );
  });

  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  protected readonly account = computed(() => this.result.value()?.account);
  protected readonly requests = computed(() => (this.result.value()?.jobs ?? []).filter((r) => isOpenJob(r.job) && !['verified', 'invoiced', 'paid'].includes(r.job.stage)).slice(0, 4));
  protected readonly needsAnswer = computed(() => this.requests().filter((r) => r.job.stage === 'completed').length);

  /** The server sends only what this resident should see (their scheme, their unit). */
  private readonly allNotices = toSignal(this.notifications.list().pipe(catchError(() => of([] as AppNotification[]))), { initialValue: [] as AppNotification[] });
  protected readonly notices = computed(() => this.allNotices().slice(0, 4));

  protected readonly where = computed(() => this.session.assignment().label);

  protected readonly firstName = computed(() => this.session.identity().name.split(' ')[0]);
  protected readonly status = residentStatus;
  protected readonly formatDate = formatDate;
  protected readonly relativeTime = relativeTime;
  protected readonly rand = (n: number) => formatRand(n);
}
