import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { Illustration } from '../illustration/illustration';

/**
 * Shown when data could not be loaded. Says what failed and offers a retry.
 * - page:   replaces the page body
 * - inline: replaces one widget/panel so the rest of the page keeps working
 */
@Component({
  selector: 'ui-error-state',
  imports: [IonIcon, Illustration],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'variant()', role: 'alert' },
  template: `
    @if (variant() === 'page') {
      <ui-illustration name="error" [size]="140" />
    } @else {
      <ion-icon name="cloud-offline-outline" aria-hidden="true" />
    }
    <div class="text">
      <h3>{{ title() }}</h3>
      <p>{{ message() }}</p>
    </div>
    <button type="button" class="btn btn-secondary" [class.btn-sm]="variant() === 'inline'" (click)="retry.emit()">
      <ion-icon name="refresh-outline" aria-hidden="true" /> Try again
    </button>
  `,
  styles: `
    :host(.page) {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: var(--s-10) var(--s-6);
      text-align: center;
    }
    :host(.page) ui-illustration { margin-bottom: var(--s-4); }
    :host(.page) h3 { font-size: var(--fs-lg); }
    :host(.page) p { max-width: 460px; margin: var(--s-2) 0 var(--s-5); color: var(--c-text-muted); }

    :host(.inline) {
      display: flex;
      align-items: center;
      gap: var(--s-3);
      padding: var(--s-3) var(--s-4);
      background: var(--c-danger-soft);
      border-radius: var(--r);
    }
    :host(.inline) > ion-icon { flex: none; font-size: 20px; color: var(--c-danger); }
    :host(.inline) .text { flex: 1; min-width: 0; }
    :host(.inline) h3 { font-family: var(--font-sans); font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
    :host(.inline) p { font-size: var(--fs-xs); color: var(--c-text-2); }
  `,
})
export class ErrorState {
  readonly variant = input<'page' | 'inline'>('page');
  readonly title = input('We couldn’t load this');
  readonly message = input(
    'Something went wrong while fetching the data. Nothing you entered was lost — try again, and if it keeps happening, contact support.',
  );
  readonly retry = output<void>();
}
