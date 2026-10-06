import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';

/** Shown when a list or page has nothing to display. Always explain why and what to do next. */
@Component({
  selector: 'ui-empty-state',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="icon"><ion-icon [name]="icon()" aria-hidden="true" /></div>
    <h3>{{ title() }}</h3>
    @if (message()) {
      <p>{{ message() }}</p>
    }
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: var(--s-12) var(--s-6);
      text-align: center;
    }
    .icon {
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      margin-bottom: var(--s-4);
      font-size: 24px;
      color: var(--c-text-muted);
      background: var(--c-surface-sunken);
      border-radius: var(--r-lg);
    }
    h3 { font-size: var(--fs-md); }
    p { max-width: 420px; margin-top: var(--s-2); color: var(--c-text-muted); }
    .actions { display: flex; gap: var(--s-2); margin-top: var(--s-5); }
    .actions:empty { display: none; }
  `,
})
export class EmptyState {
  readonly icon = input('file-tray-outline');
  readonly title = input.required<string>();
  readonly message = input<string>();
}
