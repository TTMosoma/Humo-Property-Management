import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map, of, switchMap } from 'rxjs';
import { AccountDataSource, TEMPLATE_TIERS, UnitDataSource, periodLabel } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { DocumentTemplatesService } from '../../core/documents/document-templates.service';
import { DocumentData, DocumentRenderer } from '../documents/document-renderer';
import { TemplatePicker } from '../documents/template-picker';
import { RelationshipChain } from '../../ui/record/relationship-chain';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { links, statementSendFailure, unitChain } from './account-view';

/**
 * A levy statement: opening balance, charges, payments, adjustments,
 * interest and closing balance — laid out as the document the owner receives,
 * and printable straight from the browser.
 *
 * The statement opens exactly as it was issued (its template and version).
 * Staff can preview it in any template their plan includes, with the same
 * data; that changes nothing that was sent. Settings → Documents & templates
 * links here with ?template= to preview a template on a real statement.
 */
@Component({
  selector: 'app-statement-page',
  imports: [RelationshipChain, DocumentRenderer, TemplatePicker, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
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
  protected readonly registry = inject(DocumentTemplatesService);

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

  // ---- Template: as issued, or a preview in another template the plan includes

  private readonly requested = toSignal(
    this.route.queryParamMap.pipe(map((p) => (p.get('template') ? { templateId: p.get('template')!, version: Number(p.get('v')) || undefined } : null))),
    { initialValue: null },
  );
  private readonly picked = signal<string | null>(null);
  protected readonly choosing = signal(false);
  /** Owners only ever see what they were sent. */
  protected readonly canPreview = computed(() => !this.isOwnerView() && this.session.can('Accounts.View'));
  protected readonly options = computed(() => this.registry.forType('levy-statement'));
  protected readonly defaultTemplate = computed(() => this.registry.defaultFor('levy-statement'));

  /** The template shown: the one picked (if the plan includes it), else as issued. */
  protected readonly shown = computed(() => {
    const v = this.view();
    if (!v) return undefined;
    const picked = this.picked();
    const wanted = !this.canPreview() ? null : picked ? { templateId: picked, version: undefined } : this.requested();
    const usable = wanted && this.options().some((o) => o.template.id === wanted.templateId && o.state === 'available');
    const sameAsIssued = wanted?.templateId === v.issuedWith.templateId && (wanted.version ?? v.issuedWith.version) === v.issuedWith.version;
    if (usable && !sameAsIssued) return this.registry.resolve(wanted) ?? this.registry.resolve(v.issuedWith);
    return this.registry.resolve(v.issuedWith);
  });
  protected readonly previewing = computed(() => {
    const s = this.shown();
    const v = this.view();
    return !!s && !!v && (s.template.id !== v.issuedWith.templateId || s.version.version !== v.issuedWith.version);
  });
  protected readonly issued = computed(() => {
    const v = this.view();
    return v ? this.registry.resolve(v.issuedWith) : undefined;
  });
  protected readonly tierLabel = (tier: keyof typeof TEMPLATE_TIERS) => TEMPLATE_TIERS[tier].label;

  protected readonly document = computed<DocumentData | undefined>(() => {
    const v = this.view();
    return v ? { type: 'levy-statement', view: v } : undefined;
  });

  protected choose(id: string): void {
    this.picked.set(id);
  }

  protected showIssued(): void {
    this.picked.set(this.view()?.issuedWith.templateId ?? null);
  }

  /** Staff: the unit from the URL. Owners: the unit their assignment is for. */
  private keyFrom(p: ParamMap): { schemeId: string; number: string; unitId?: string; period: string } {
    const schemeId = p.get('schemeId');
    if (schemeId) return { schemeId, number: p.get('unitId') ?? '', period: p.get('period')! };
    return { schemeId: '', number: '', unitId: this.session.assignment().scope.unitId, period: p.get('period')! };
  }

  protected print(): void {
    window.print();
  }

  protected readonly sending = signal(false);
  protected readonly canSend = computed(() => !this.isOwnerView() && this.session.can('Collections.Manage'));

  /** Emails this statement to the holder; it's recorded in Communications › Sent. */
  protected email(): void {
    const v = this.view();
    if (!v || this.sending()) return;
    this.sending.set(true);
    this.accounts.sendStatement(v.account.id, v.statement.period).subscribe({
      next: () => {
        this.sending.set(false);
        this.feedback.success(`Emailed to ${v.holder.email}. It’s in Communications › Sent.`);
      },
      error: (e: unknown) => {
        this.sending.set(false);
        this.feedback.error(statementSendFailure(e));
      },
    });
  }
}
