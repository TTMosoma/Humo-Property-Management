import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map, switchMap, throwError } from 'rxjs';
import { AccountDataSource, ApiError, TimelineDataSource, UnitDataSource, periodLabel, periodOf } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { RoleSwitcher } from '../../core/session/role-switcher';
import { SessionService } from '../../core/session/session.service';
import { RandPipe, formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';

/**
 * Owner portal › My account. Job: "what do I owe, why, how do I pay, and did
 * you get my payment?" — answered without phoning the managing agent.
 */
@Component({
  selector: 'app-owner-account-page',
  imports: [PageHeader, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './owner-account-page.html',
  styleUrl: './owner-account-page.scss',
})
export class OwnerAccountPage {
  private readonly session = inject(SessionService);
  private readonly units = inject(UnitDataSource);
  private readonly accounts = inject(AccountDataSource);
  private readonly timeline = inject(TimelineDataSource);
  private readonly feedback = inject(FeedbackService);

  private readonly switcher = inject(RoleSwitcher);

  /** The owner's unit (from the active assignment) and its levy account. Missing either is an error here. */
  protected readonly result = loadable(() => {
    const unitId = this.session.assignment().scope.unitId ?? '';
    return this.units.byId(unitId).pipe(
      switchMap((summary) => {
        if (!summary) return throwError(() => new ApiError('not-found', 'Unit not found'));
        return this.accounts.get(summary.account.id).pipe(
          map((detail) => {
            if (!detail) throw new ApiError('not-found', 'Account not found');
            return { summary, detail };
          }),
        );
      }),
    );
  });
  protected readonly summary = computed(() => this.result.value()?.summary);
  protected readonly detail = computed(() => this.result.value()?.detail);

  protected readonly paidOpen = signal(false);
  protected readonly paidText = signal('');

  protected readonly current = computed(() => {
    const d = this.detail();
    if (!d) return null;
    const period = d.statementPeriods[0];
    if (!period) return null;
    const charges = d.transactions.filter((t) => t.amount > 0 && periodOf(t.date) === period).reverse();
    return { period, label: periodLabel(period, false), charges };
  });

  protected readonly recent = computed(() => this.detail()?.transactions.slice(0, 8) ?? []);
  protected readonly otherUnits = computed(() => this.session.assignments().filter((m) => m.role === 'owner' && m.id !== this.session.assignment().id));

  protected readonly formatDate = formatDate;
  protected readonly periodLabel = periodLabel;

  protected dueDate(): string {
    const d = new Date();
    d.setDate(7);
    return formatDate(d.toISOString());
  }

  /** Each unit is its own assignment: switching unit is a role switch that stays on this page. */
  protected switchUnit(id: string): void {
    this.switcher.switchTo(id, '/my/account');
  }

  protected sendPaid(): void {
    const s = this.summary();
    if (!s) return;
    const text = `Owner reports payment: ${this.paidText().trim() || '(no details)'}`;
    this.timeline.addNote({ unitId: s.unit.id, personId: s.owners[0]?.id, kind: 'note', text }).subscribe({
      next: () => {
        this.paidOpen.set(false);
        this.paidText.set('');
        this.feedback.success('Thanks — we’ll match your payment and let you know.');
      },
      error: () => this.feedback.error('That didn’t send. Please try again.'),
    });
  }
}
