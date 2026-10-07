import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { AccountDataSource, TimelineDataSource, UnitDataSource, periodLabel, periodOf } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { pageState } from '../../core/prototype/page-state';
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
  protected readonly page = pageState();

  private readonly key = computed(() => {
    const m = this.session.membership();
    return { schemeId: m.schemeIds[0], number: (m.unitLabel ?? '').replace(/\D/g, '') };
  });

  protected readonly summary = toSignal(
    toObservable(this.key).pipe(
      switchMap((k) => this.units.get(k.schemeId, k.number).pipe(map((s) => s ?? null), catchError(() => of(null)))),
    ),
  );

  protected readonly detail = toSignal(
    toObservable(this.summary).pipe(
      switchMap((s) => (s ? this.accounts.get(s.account.id).pipe(map((d) => d ?? null), catchError(() => of(null))) : of(s))),
    ),
  );

  protected readonly paidOpen = signal(false);
  protected readonly paidText = signal('');

  protected readonly current = computed(() => {
    const d = this.detail();
    if (!d) return null;
    const period = d.statementPeriods[0];
    const charges = d.transactions.filter((t) => t.amount > 0 && periodOf(t.date) === period).reverse();
    return { period, label: periodLabel(period, false), charges };
  });

  protected readonly recent = computed(() => this.detail()?.transactions.slice(0, 8) ?? []);
  protected readonly otherUnits = computed(() => this.session.memberships().filter((m) => m.role === 'owner' && m.id !== this.session.membership().id));

  protected readonly formatDate = formatDate;
  protected readonly periodLabel = periodLabel;

  protected dueDate(): string {
    const d = new Date();
    d.setDate(7);
    return formatDate(d.toISOString());
  }

  protected switchUnit(id: string): void {
    this.session.switchMembership(id);
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
