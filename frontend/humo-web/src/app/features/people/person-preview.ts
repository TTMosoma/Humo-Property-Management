import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, map, of } from 'rxjs';
import { PersonDataSource, PersonSummary } from '../../domain';
import { Drawer } from '../../ui/drawer/drawer';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { links } from '../accounts/account-view';
import { LogNote } from '../shared/log-note';
import { PersonRelationships } from './person-relationships';

/** Quick look at a person: how to reach them, every role they hold, and a place to log the call. */
@Component({
  selector: 'app-person-preview',
  imports: [Drawer, PersonRelationships, LogNote, Skeleton, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (summary() === undefined) {
      <ui-drawer title="Loading…"><ui-skeleton [count]="4" /></ui-drawer>
    } @else if (summary() === null) {
      <ui-drawer title="Person unavailable">
        <ui-error-state variant="inline" title="We couldn’t load this person" message="Close and try again." (retry)="ref.close()" />
      </ui-drawer>
    } @else {
      @let p = summary()!;
      <ui-drawer [eyebrow]="p.person.kind === 'individual' ? 'Person' : p.person.kind === 'company' ? 'Company' : 'Trust'" [title]="p.person.displayName" [openLink]="link(p.person.id)">
        <div drawerMeta class="contact">
          <span>{{ p.person.phone }}</span>
          <span>{{ p.person.email }}</span>
          <span class="pref">Prefers {{ p.person.preferredChannel === 'whatsapp' ? 'WhatsApp' : p.person.preferredChannel === 'sms' ? 'SMS' : 'email' }}</span>
        </div>
        <h3 class="section-title">Roles</h3>
        <app-person-relationships [person]="p" (navigated)="ref.close()" />
        <h3 class="section-title gap">Log a call</h3>
        <app-log-note [personId]="p.person.id" [unitId]="firstUnit(p)" />
      </ui-drawer>
    }
  `,
  styles: `
    .contact { display: flex; flex-wrap: wrap; gap: var(--s-1) var(--s-3); margin-top: var(--s-2); font-size: var(--fs-sm); color: var(--c-text-2); }
    .pref { color: var(--c-accent-strong); }
    .section-title { margin-bottom: var(--s-2); font-size: var(--fs-md); }
    .gap { margin-top: var(--s-6); }
  `,
})
export class PersonPreview {
  private readonly data = inject<{ personId: string }>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  protected readonly summary = toSignal(
    inject(PersonDataSource)
      .get(this.data.personId)
      .pipe(
        map((p) => p ?? null),
        catchError(() => of(null)),
      ),
  );

  protected link(id: string): string {
    return links.person({ id });
  }

  protected firstUnit(p: PersonSummary): string | undefined {
    return p.relationships.find((r) => r.unit)?.unit?.id;
  }
}
