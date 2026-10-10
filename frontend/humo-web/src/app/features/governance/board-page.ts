import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { forkJoin, map, take } from 'rxjs';
import { BoardDataSource, BoardView, ResolutionDataSource, TrusteeView } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { ChainLink } from '../../ui/record/relationship-chain';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { links } from '../accounts/account-view';
import { appointForm, endTermForm, minimumForm, portfolioForm } from './board-forms';

/** One scheme's trustee board: who's on it, how they got there, and who has left. */
@Component({
  selector: 'app-board-page',
  imports: [RecordHeader, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this board" (retry)="result.retry()" /></div>
    } @else if (result.value() === false) {
      <div class="surface">
        <ui-empty-state illustration="not-found" title="We couldn’t find that scheme">
          <a class="btn btn-primary" routerLink="/governance/trustees">Trustee boards</a>
        </ui-empty-state>
      </div>
    } @else {
      @let b = view()!;
      <ui-record-header eyebrow="Trustee board" [title]="b.scheme.name" [status]="status()" [facts]="facts()" [chain]="chain()">
        @if (canManage()) {
          <ng-container recordActions>
            <button type="button" class="btn btn-secondary" (click)="minimum()">Board size</button>
            <button type="button" class="btn btn-primary" (click)="appoint()"><ion-icon name="person-add-outline" aria-hidden="true" /> Add a trustee</button>
          </ng-container>
        }
      </ui-record-header>

      @if (b.trustees.length < b.minimum) {
        <p class="banner surface warn">
          The board has {{ b.trustees.length }} {{ b.trustees.length === 1 ? 'trustee' : 'trustees' }}; it needs at least {{ b.minimum }}.
          The board can co-opt an owner until the next AGM{{ b.nextAgm ? ' (' + b.nextAgm.ref + ', ' + formatDate(b.nextAgm.scheduledFor) + ')' : '' }}, where the owners elect trustees.
        </p>
      }

      <section class="surface panel">
        <h2 class="section-title">In office</h2>
        @if (!b.trustees.length) {
          <p class="muted">No trustees on record.</p>
        } @else {
          <ul class="people">
            @for (t of b.trustees; track t.relationship.id) {
              <li>
                <span class="avatar" aria-hidden="true">{{ t.person.initials }}</span>
                <div class="who">
                  <a class="name" [routerLink]="personLink(t)">{{ t.person.displayName }}</a>
                  <div class="muted">{{ t.units.length ? 'Owner of ' + t.units.join(', ') : 'No unit on record' }} · since {{ formatDate(t.relationship.since) }}</div>
                  <div class="muted">{{ how(t) }}</div>
                </div>
                <div class="tags">
                  <ui-status-pill [label]="t.relationship.portfolio ?? 'Trustee'" [tone]="t.relationship.portfolio === 'Chairperson' ? 'info' : 'neutral'" />
                  @if (!t.hasSignIn) {
                    <span class="muted" title="They can’t approve or read meeting packs in Humo Property Management until they’re invited">No Humo sign-in</span>
                  }
                </div>
                @if (canManage()) {
                  <div class="act">
                    <button type="button" class="btn btn-ghost btn-sm" (click)="portfolio(t)">Portfolio</button>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="end(t)">End term</button>
                  </div>
                }
              </li>
            }
          </ul>
        }
      </section>

      @if (b.former.length) {
        <section class="surface panel">
          <h2 class="section-title">Former trustees</h2>
          <ul class="people former">
            @for (t of b.former; track t.relationship.id) {
              <li>
                <span class="avatar" aria-hidden="true">{{ t.person.initials }}</span>
                <div class="who">
                  <a class="name" [routerLink]="personLink(t)">{{ t.person.displayName }}</a>
                  <div class="muted">{{ t.relationship.portfolio ?? 'Trustee' }} · {{ formatDate(t.relationship.since) }} to {{ formatDate(t.relationship.until) }}{{ t.relationship.endReason ? ' · ' + t.relationship.endReason : '' }}</div>
                </div>
              </li>
            }
          </ul>
        </section>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    .banner { margin: 0; padding: var(--s-3) var(--s-5); }
    .banner.warn { border-left: 3px solid var(--c-warning); }
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .people { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
    .people li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); padding: var(--s-3) 0; border-top: 1px solid var(--c-border); }
    .people li:first-child { border-top: none; }
    .avatar {
      display: grid; flex: none; place-items: center; width: 40px; height: 40px;
      font-size: var(--fs-sm); font-weight: var(--fw-medium); background: var(--c-surface-sunken); border-radius: 50%;
    }
    .former .avatar { opacity: 0.6; }
    .who { flex: 1; min-width: 200px; }
    .name { font-weight: var(--fw-medium); }
    .tags { display: flex; flex-direction: column; align-items: flex-end; gap: var(--s-1); }
    .act { display: flex; gap: var(--s-1); }
  `,
})
export class BoardPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(BoardDataSource);
  private readonly resolutions = inject(ResolutionDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly session = inject(SessionService);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('schemeId')!)), { initialValue: this.route.snapshot.paramMap.get('schemeId')! });
  /** undefined = loading; false = not found. */
  protected readonly result = loadable(() => this.data.get(this.id()).pipe(map((d) => d ?? (false as const))));
  protected readonly view = computed<BoardView | undefined>(() => this.result.value() || undefined);

  protected readonly formatDate = formatDate;
  protected readonly canManage = computed(() => this.session.can('Meetings.Manage') && this.session.hasFeature('governance') && !this.session.readOnly());

  protected readonly status = computed(() => {
    const b = this.view();
    if (!b) return null;
    return b.trustees.length < b.minimum ? { label: 'Below minimum', tone: 'danger' as const } : { label: 'Full board', tone: 'success' as const };
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const b = this.view();
    if (!b) return [];
    return [
      { label: 'In office', value: String(b.trustees.length), hint: `at least ${b.minimum}`, tone: b.trustees.length < b.minimum ? 'danger' : 'default' },
      { label: 'Chairperson', value: b.trustees.find((t) => t.relationship.portfolio === 'Chairperson')?.person.displayName ?? '—' },
      { label: 'Co-opted', value: String(b.coOpted), hint: 'until the next AGM' },
      { label: 'Next AGM', value: b.nextAgm ? formatDate(b.nextAgm.scheduledFor, true) : 'Not scheduled', hint: b.nextAgm?.ref },
    ];
  });

  protected readonly chain = computed<ChainLink[]>(() => {
    const b = this.view();
    if (!b) return [];
    return [
      { kind: 'Scheme', label: b.scheme.name, route: links.scheme(b.scheme) },
      { kind: 'Governance', label: 'Trustee board' },
    ];
  });

  protected personLink(t: TrusteeView): string {
    return links.person(t.person);
  }

  protected how(t: TrusteeView): string {
    const a = t.relationship.appointment;
    if (a?.how === 'elected') return `Elected by the owners${a.resolutionRef ? ` · ${a.resolutionRef}` : ''}`;
    if (a?.how === 'co-opted') return 'Co-opted by the board · serves until the next AGM';
    return 'In office before the scheme moved to Humo Property Management';
  }

  // ---- Commands

  protected appoint(): void {
    const b = this.view()!;
    forkJoin([this.data.candidates(b.scheme.id).pipe(take(1)), this.resolutions.list([b.scheme.id], { pageSize: 500 }).pipe(take(1), map((p) => p.items))]).subscribe(([c, r]) =>
      appointForm(this.drawer, this.data, b, c, r),
    );
  }

  protected end(t: TrusteeView): void {
    endTermForm(this.drawer, this.data, this.view()!, t);
  }

  protected portfolio(t: TrusteeView): void {
    portfolioForm(this.drawer, this.data, this.view()!, t);
  }

  protected minimum(): void {
    minimumForm(this.drawer, this.data, this.view()!);
  }
}
