import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { PersonDataSource, TimelineDataSource, TimelineEvent } from '../../domain';
import { pageState } from '../../core/prototype/page-state';
import { formatRand } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { Timeline } from '../../ui/timeline/timeline';
import { LogNote } from '../shared/log-note';
import { PersonRelationships } from './person-relationships';

/**
 * A person's record. One canonical page however many units and roles they
 * have (decision D1); the relationship header links into each unit and account.
 */
@Component({
  selector: 'app-person-page',
  imports: [RecordHeader, PersonRelationships, Timeline, LogNote, EmptyState, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (page.status() === 'loading' || summary() === undefined) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (page.status() === 'error' || summary() === null) {
      <div class="surface"><ui-error-state title="We couldn’t load this person" (retry)="page.retry()" /></div>
    } @else if (summary() === false) {
      <div class="surface"><ui-empty-state illustration="not-found" title="We couldn’t find that person" message="They may have been removed, or you may not have access to their schemes." /></div>
    } @else {
      @let p = person()!;
      <ui-record-header
        [eyebrow]="p.person.kind === 'individual' ? 'Person' : p.person.kind === 'company' ? 'Company · contact ' + p.person.firstName + ' ' + p.person.lastName : 'Trust'"
        [title]="p.person.displayName"
        [subtitle]="p.person.phone + ' · ' + p.person.email"
        [facts]="facts()"
      />
      <div class="grid">
        <div class="main">
          <section class="surface panel">
            <h2 class="section-title">Roles & accounts</h2>
            <app-person-relationships [person]="p" />
          </section>
          <section class="surface panel">
            <h2 class="section-title">Contact preferences</h2>
            <dl>
              <dt>Mobile</dt><dd>{{ p.person.phone }}</dd>
              <dt>Email</dt><dd>{{ p.person.email }}</dd>
              <dt>Prefers</dt><dd>{{ channel() }}</dd>
              <dt>Portal access</dt><dd>{{ p.person.personaId ? 'Active' : 'Not invited yet' }}</dd>
            </dl>
          </section>
        </div>
        <aside class="surface panel">
          <h2 class="section-title">Activity</h2>
          <app-log-note [personId]="p.person.id" [unitId]="firstUnit()" />
          <div class="tl">
            @if (timeline() === null) {
              <ui-error-state variant="inline" title="Activity unavailable" message="The rest of the page still works." (retry)="page.retry()" />
            } @else if (timeline() === undefined) {
              <ui-skeleton [count]="4" />
            } @else {
              <ui-timeline [events]="timelineEvents()" />
            }
          </div>
        </aside>
      </div>
    }
  `,
  styles: `
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 420px); gap: var(--s-5); align-items: start; }
    .main { display: grid; gap: var(--s-5); }
    .panel { padding: var(--s-5); }
    .section-title { margin-bottom: var(--s-3); font-size: var(--fs-md); }
    dl { display: grid; grid-template-columns: 140px 1fr; gap: var(--s-2) var(--s-4); margin: 0; font-size: var(--fs-sm); }
    dt { color: var(--c-text-muted); }
    dd { margin: 0; }
    .tl { margin-top: var(--s-5); padding-top: var(--s-4); border-top: 1px solid var(--c-border); }
    @media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class PersonPage {
  private readonly route = inject(ActivatedRoute);
  private readonly people = inject(PersonDataSource);
  private readonly timelineData = inject(TimelineDataSource);
  protected readonly page = pageState();

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('personId')!)), {
    initialValue: this.route.snapshot.paramMap.get('personId')!,
  });

  protected readonly summary = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) => this.people.get(id).pipe(map((p) => p ?? (false as const)), catchError(() => of(null)))),
    ),
  );

  protected readonly person = computed(() => {
    const s = this.summary();
    return s ? s : undefined;
  });

  protected readonly timeline = toSignal(
    toObservable(this.id).pipe(switchMap((id) => this.timelineData.forPerson(id).pipe(catchError(() => of(null))))),
  );

  protected readonly facts = computed<KeyFact[]>(() => {
    const p = this.person();
    if (!p) return [];
    const owned = p.relationships.filter((r) => r.relationship.type === 'owner').length;
    const trustee = p.relationships.filter((r) => r.relationship.type === 'trustee').length;
    const facts: KeyFact[] = [{ label: 'Units owned', value: String(owned) }];
    if (owned) facts.push({ label: 'Total balance', value: formatRand(p.balance), tone: p.balance > 0 ? 'warning' : p.balance < 0 ? 'success' : 'default' });
    if (p.relationships.some((r) => r.relationship.type === 'tenant')) facts.push({ label: 'Renting', value: String(p.relationships.filter((r) => r.relationship.type === 'tenant').length) });
    if (trustee) facts.push({ label: 'Trustee of', value: `${trustee} scheme${trustee > 1 ? 's' : ''}` });
    return facts;
  });

  protected channel(): string {
    const c = this.person()?.person.preferredChannel;
    return c === 'whatsapp' ? 'WhatsApp' : c === 'sms' ? 'SMS' : 'Email';
  }

  protected firstUnit(): string | undefined {
    return this.person()?.relationships.find((r) => r.unit)?.unit?.id;
  }

  protected timelineEvents(): TimelineEvent[] {
    return this.timeline() ?? [];
  }
}
