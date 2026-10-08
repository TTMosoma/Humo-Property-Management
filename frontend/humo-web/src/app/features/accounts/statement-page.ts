import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map, of, switchMap } from 'rxjs';
import { AccountDataSource, UnitDataSource, periodLabel } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
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

  /** Staff reach this via /schemes/:schemeId/units/:unitId/…; owners via /my/statements/:period (their own unit). */
  private readonly key = toSignal(this.route.paramMap.pipe(map((p) => this.keyFrom(p))), {
    initialValue: this.keyFrom(this.route.snapshot.paramMap),
  });

  protected readonly isOwnerView = computed(() => !this.route.snapshot.paramMap.get('schemeId'));

  /** The unit, then its statement for the period. A missing unit or statement is "not found", not an error. */
  protected readonly result = loadable(() => {
    const k = this.key();
    const unit$ = k.unitId ? this.units.byId(k.unitId) : this.units.get(k.schemeId, k.number);
    return unit$.pipe(
      switchMap((summary) =>
        summary ? this.accounts.statement(summary.account.id, k.period).pipe(map((view) => ({ summary, view }))) : of({ summary, view: undefined }),
      ),
    );
  });
  protected readonly summary = computed(() => this.result.value()?.summary);
  protected readonly view = computed(() => this.result.value()?.view);

  protected readonly chain = computed(() => {
    const s = this.summary();
    if (!s) return [];
    return [...unitChain(s, s.account), { kind: 'Statement', label: periodLabel(this.key().period) }];
  });

  protected readonly links = links;
  protected readonly formatDate = formatDate;

  /** Staff: the unit from the URL. Owners: the unit their assignment is for. */
  private keyFrom(p: ParamMap): { schemeId: string; number: string; unitId?: string; period: string } {
    const schemeId = p.get('schemeId');
    if (schemeId) return { schemeId, number: p.get('unitId') ?? '', period: p.get('period')! };
    return { schemeId: '', number: '', unitId: this.session.assignment().scope.unitId, period: p.get('period')! };
  }

  protected print(): void {
    window.print();
  }

  protected email(): void {
    const v = this.view();
    if (v) this.feedback.info(`Prototype: this statement would be emailed to ${v.holder.email}.`);
  }
}
