import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';

/** Shown when data could not be loaded. Says what failed and offers a retry. */
@Component({
  selector: 'ui-error-state',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="icon"><ion-icon name="cloud-offline-outline" aria-hidden="true" /></div>
    <h3>{{ title() }}</h3>
    <p>{{ message() }}</p>
    <button type="button" class="btn btn-secondary" (click)="retry.emit()">
      <ion-icon name="refresh-outline" aria-hidden="true" /> Try again
    </button>
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
      color: var(--c-danger);
      background: var(--c-danger-soft);
      border-radius: var(--r-lg);
    }
    h3 { font-size: var(--fs-md); }
    p { max-width: 440px; margin: var(--s-2) 0 var(--s-5); color: var(--c-text-muted); }
  `,
})
export class ErrorState {
  readonly title = input('We couldn’t load this page');
  readonly message = input(
    'Something went wrong while fetching the data. Your work is safe — try again, and if it keeps happening, contact support.',
  );
  readonly retry = output<void>();
}
