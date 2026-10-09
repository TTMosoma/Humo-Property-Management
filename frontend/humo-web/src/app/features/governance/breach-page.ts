import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { BREACH_STATUS_LABELS, BreachView, RulesDataSource, TimelineEvent, TimelineKind } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { ChainLink } from '../../ui/record/relationship-chain';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { Timeline } from '../../ui/timeline/timeline';
import { links } from '../accounts/account-view';
import { BREACH_TONE } from './rules-page';
import { breachNoteForm, warnForm } from './rules-forms';

const EVENT_KIND: Record<string, TimelineKind> = { reported: 'status', warning: 'document', 'final-warning': 'document', note: 'note', referred: 'status', resolved: 'status', reopened: 'status' };

/**
 * One reported breach of a scheme rule: what happened, the letters sent and
 * what's next. Warnings first; if it isn't put right, the trustees decide.
 * No fines.
 */
@Component({
  selector: 'app-breach-page',
  imports: [RecordHeader, Timeline, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this breach" (retry)="result.retry()" /></div>
    } @else if (result.value() === false) {
      <div class="surface">
        <ui-empty-state illustration="not-found" title="We couldn’t find that breach">
          <a class="btn btn-primary" routerLink="/governance/rules" [queryParams]="{ tab: 'breaches' }">Breach log</a>
        </ui-empty-state>
      </div>
    } @else {
      @let v = view()!;
      @let b = v.breach;
      <ui-record-header [eyebrow]="b.ref + ' · Rule breach'" [title]="'Rule ' + v.rule.number + ': ' + v.rule.title" [subtitle]="'Unit ' + v.unit.number + ' · ' + v.scheme.name" [status]="status()" [facts]="facts()" [chain]="chain()">
        @if (canEnforce()) {
          <ng-container recordActions>
            <button type="button" class="btn btn-ghost" (click)="note('note')">Add a note</button>
            @switch (b.status) {
              @case ('open') {
                <button type="button" class="btn btn-secondary" (click)="note('resolve')">Resolve</button>
                <button type="button" class="btn btn-primary" (click)="warn(false)"><ion-icon name="mail-outline" aria-hidden="true" /> Send a warning</button>
              }
              @case ('warned') {
                <button type="button" class="btn btn-secondary" (click)="note('resolve')">Resolve</button>
                <button type="button" class="btn btn-secondary" (click)="note('refer')">Refer to the trustees</button>
                <button type="button" class="btn btn-primary" (click)="warn(true)"><ion-icon name="mail-outline" aria-hidden="true" /> Send a final warning</button>
              }
              @case ('final-warning') {
                <button type="button" class="btn btn-secondary" (click)="note('resolve')">Resolve</button>
                <button type="button" class="btn btn-primary" (click)="note('refer')">Refer to the trustees</button>
              }
              @case ('with-trustees') {
                <button type="button" class="btn btn-primary" (click)="note('resolve')">Record the outcome</button>
              }
              @case ('resolved') {
                <button type="button" class="btn btn-secondary" (click)="note('reopen')">Reopen</button>
              }
            }
          </ng-container>
        }
      </ui-record-header>

      <div class="grid">
        <div class="main">
          <section class="surface panel">
            <h2 class="section-title">What was reported</h2>
            <p>{{ b.description }}</p>
            <p class="muted">On {{ formatDate(b.occurredAt) }} · logged by {{ b.reportedBy }}</p>
          </section>
          <section class="surface panel">
            <h2 class="section-title">History</h2>
            <ui-timeline [events]="events()" />
          </section>
        </div>
        <aside class="side">
          <section class="surface panel">
            <h2 class="section-title">The rule</h2>
            <p>{{ v.rule.versions[0].text }}</p>
            <p class="muted">Adopted {{ formatDate(v.rule.versions[0].adoptedAt) }} · {{ v.rule.versions[0].resolutionRef }}</p>
            <a [routerLink]="'/governance/rules'" [queryParams]="{ scheme: v.scheme.id }">All of {{ v.scheme.name }}’s rules</a>
          </section>
          <section class="surface panel">
            <h2 class="section-title">How breaches are handled</h2>
            <ol class="steps">
              <li [class.done]="b.status !== 'open'">A warning, with a date to put it right</li>
              <li [class.done]="b.status === 'final-warning' || b.status === 'with-trustees'">A final warning, if it isn’t</li>
              <li [class.done]="b.status === 'with-trustees'">The trustees decide the next step (e.g. a CSOS application)</li>
            </ol>
            <p class="muted">Humo Property Management doesn’t levy fines.</p>
          </section>
        </aside>
      </div>
    }
  `,
  styleUrl: '../finance/billing/billing-run-page.scss',
  styles: `
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .steps { margin: 0 0 var(--s-2); padding-left: var(--s-5); font-size: var(--fs-sm); }
    .steps li { margin-bottom: var(--s-1); }
    .steps li.done { color: var(--c-text-muted); text-decoration: line-through; }
  `,
})
export class BreachPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(RulesDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly session = inject(SessionService);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('breachId')!)), { initialValue: this.route.snapshot.paramMap.get('breachId')! });
  /** undefined = loading; false = not found. */
  protected readonly result = loadable(() => this.data.breach(this.id()).pipe(map((d) => d ?? (false as const))));
  protected readonly view = computed<BreachView | undefined>(() => this.result.value() || undefined);

  protected readonly formatDate = formatDate;
  protected readonly canEnforce = computed(() => this.session.can('Rules.Enforce') && this.session.hasFeature('governance') && !this.session.readOnly());

  protected readonly status = computed(() => {
    const s = this.view()?.breach.status;
    return s ? { label: BREACH_STATUS_LABELS[s], tone: BREACH_TONE[s] } : null;
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const v = this.view();
    if (!v) return [];
    const b = v.breach;
    const late = !!b.remedyBy && b.remedyBy < new Date().toISOString().slice(0, 10) && (b.status === 'warned' || b.status === 'final-warning');
    return [
      { label: v.personRole === 'tenant' ? 'Tenant' : 'Owner', value: v.person.displayName },
      { label: 'Warnings', value: String(b.events.filter((e) => e.kind === 'warning' || e.kind === 'final-warning').length) },
      { label: 'Put right by', value: b.remedyBy ? formatDate(b.remedyBy, true) : '—', tone: late ? 'danger' : 'default', hint: late ? 'passed' : undefined },
      { label: 'Earlier breaches', value: String(v.repeats), hint: 'same rule, same unit', tone: v.repeats ? 'warning' : 'default' },
      { label: 'With', value: v.assigneeName },
    ];
  });

  protected readonly chain = computed<ChainLink[]>(() => {
    const v = this.view();
    if (!v) return [];
    return [
      { kind: 'Scheme', label: v.scheme.name, route: links.scheme(v.scheme) },
      { kind: 'Unit', label: `Unit ${v.unit.number}`, route: links.unit(v.scheme, v.unit) },
      { kind: v.personRole === 'tenant' ? 'Tenant' : 'Owner', label: v.person.displayName, route: links.person(v.person) },
      { kind: 'Breach', label: v.breach.ref },
    ];
  });

  protected readonly events = computed<TimelineEvent[]>(() =>
    [...(this.view()?.breach.events ?? [])]
      .reverse()
      .map((e, i) => ({ id: `${i}`, at: e.at, kind: EVENT_KIND[e.kind] ?? 'status', title: e.text, actor: e.by, link: e.sentId ? `/communications/sent/${e.sentId}` : undefined })),
  );

  protected warn(final: boolean): void {
    warnForm(this.drawer, this.data, this.view()!, final);
  }

  protected note(kind: 'note' | 'refer' | 'resolve' | 'reopen'): void {
    breachNoteForm(this.drawer, this.data, this.view()!, kind);
  }
}
