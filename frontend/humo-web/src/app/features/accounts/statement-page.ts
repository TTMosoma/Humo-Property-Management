import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { AccountDataSource, UnitDataSource, periodLabel } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { pageState } from '../../core/prototype/page-state';
import { SessionService } from '../../core/session/session.service';
import { Logo } from '../../ui/brand/logo';
import { RandPipe, formatDate } from '../../ui/format/money';
import { RelationshipChain } from '../../ui/record/relationship-chain';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { links, unitChain } from './account-view';

/**
 * A levy statement: opening balance, charges, payments, adjustments,
 * interest and closing balance — laid out as the document the owner receives,
 * and printable straight from the browser.
 */
@Component({
  selector: 'app-statement-page',
  imports: [RelationshipChain, Logo, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './statement-page.html',
  styleUrl: './statement-page.scss',
})
export class StatementPage {
  private readonly route = inject(ActivatedRoute);
  private readonly units = inject(UnitDataSource);
  private readonly accounts = inject(AccountDataSource);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);
  protected readonly page = pageState();

  /** Staff reach this via /schemes/:schemeId/units/:unitId/…; owners via /my/statements/:period (their own unit). */
  private readonly key = toSignal(this.route.paramMap.pipe(map((p) => this.keyFrom(p))), {
    initialValue: this.keyFrom(this.route.snapshot.paramMap),
  });

  protected readonly isOwnerView = computed(() => !this.route.snapshot.paramMap.get('schemeId'));

  protected readonly summary = toSignal(
    toObservable(this.key).pipe(
      switchMap((k) => this.units.get(k.schemeId, k.number).pipe(map((s) => s ?? null), catchError(() => of(null)))),
    ),
  );

  protected readonly view = toSignal(
    toObservable(computed(() => ({ s: this.summary(), period: this.key().period }))).pipe(
      switchMap(({ s, period }) =>
        s ? this.accounts.statement(s.account.id, period).pipe(map((v) => v ?? null), catchError(() => of(null))) : of(s === null ? null : undefined),
      ),
    ),
  );

  protected readonly chain = computed(() => {
    const s = this.summary();
    if (!s) return [];
    return [...unitChain(s, s.account), { kind: 'Statement', label: periodLabel(this.key().period) }];
  });

  protected readonly links = links;
  protected readonly formatDate = formatDate;

  private keyFrom(p: ParamMap): { schemeId: string; number: string; period: string } {
    const m = this.session.membership();
    return {
      schemeId: p.get('schemeId') ?? m.schemeIds[0],
      number: p.get('unitId') ?? (m.unitLabel ?? '').replace(/\D/g, ''),
      period: p.get('period')!,
    };
  }

  protected print(): void {
    window.print();
  }

  protected email(): void {
    const v = this.view();
    if (v) this.feedback.info(`Prototype: this statement would be emailed to ${v.holder.email}.`);
  }
}
