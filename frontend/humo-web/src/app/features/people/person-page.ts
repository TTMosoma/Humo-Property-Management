import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { Person, PersonDataSource, RelationshipView, TimelineDataSource, TimelineEvent, UnitDataSource } from '../../domain';
import { IonIcon } from '@ionic/angular/standalone';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { editPersonForm, endRelationshipForm, linkPersonForm } from './person-forms';
import { loadable } from '../../core/data/loadable';
import { formatRand } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { Timeline } from '../../ui/timeline/timeline';
import { LogNote } from '../shared/log-note';
import { PersonRelationships } from './person-relationships';
import { AttachmentsPanel } from '../library/attachments-panel';

/**
 * A person's record. One canonical page however many units and roles they
 * have (decision D1); the relationship header links into each unit and account.
 */
@Component({
  selector: 'app-person-page',
  imports: [AttachmentsPanel, RecordHeader, PersonRelationships, Timeline, LogNote, EmptyState, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (summary.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (summary.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this person" (retry)="summary.retry()" /></div>
    } @else if (summary.value() === false) {
      <div class="surface"><ui-empty-state illustration="not-found" title="We couldn’t find that person" message="They may have been removed, or you may not have access to their schemes." /></div>
    } @else {
      @let p = person()!;
      <ui-record-header
        [eyebrow]="p.person.kind === 'individual' ? 'Person' : p.person.kind === 'company' ? 'Company · contact ' + p.person.firstName + ' ' + p.person.lastName : 'Trust'"
        [title]="p.person.displayName"
        [subtitle]="p.person.phone + ' · ' + p.person.email"
        [facts]="facts()"
      >
        @if (canManage()) {
          <ng-container recordActions>
            <button type="button" class="btn btn-secondary" (click)="edit(p.person)"><ion-icon name="create-outline" aria-hidden="true" /> Edit details</button>
            <button type="button" class="btn btn-secondary" (click)="link(p.person)"><ion-icon name="link-outline" aria-hidden="true" /> Add a role</button>
          </ng-container>
        }
      </ui-record-header>
      <div class="grid">
        <div class="main">
          <section class="surface panel">
            <h2 class="section-title">Roles & accounts</h2>
            <app-person-relationships [person]="p" [canManage]="canManage()" (end)="endRole(p.person, $event)" />
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
          <section class="surface panel">
            <app-attachments kind="person" [recordId]="p.person.id" [label]="p.person.displayName" />
          </section>
        </div>
        <aside class="surface panel">
          <h2 class="section-title">Activity</h2>
          <app-log-note [personId]="p.person.id" [unitId]="firstUnit()" />
          <div class="tl">
            @if (timeline.failed()) {
              <ui-error-state variant="inline" title="Activity unavailable" message="The rest of the page still works." (retry)="timeline.retry()" />
            } @else if (timeline.loading()) {
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
  private readonly units = inject(UnitDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly session = inject(SessionService);
  private readonly scope = inject(ScopeService);

  protected readonly canManage = computed(() => this.session.can('People.Manage') && !this.session.readOnly());

  protected edit(p: Person): void {
    editPersonForm(this.drawer, this.people, p);
  }

  protected link(p: Person): void {
    linkPersonForm(this.drawer, this.people, this.units, this.scope.accessible(), p);
  }

  protected endRole(p: Person, r: RelationshipView): void {
    endRelationshipForm(this.drawer, this.people, p, r);
  }

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('personId')!)), {
    initialValue: this.route.snapshot.paramMap.get('personId')!,
  });

  protected readonly summary = loadable(() => {
    const id = this.id();
    return this.people.get(id).pipe(map((p) => p ?? (false as const)));
  });

  protected readonly person = computed(() => {
    const s = this.summary.value();
    return s ? s : undefined;
  });

  protected readonly timeline = loadable(() => this.timelineData.forPerson(this.id()));

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
    return this.timeline.value() ?? [];
  }
}
