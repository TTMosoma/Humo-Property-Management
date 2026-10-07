import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';

/** Sticky bar shown while rows are selected. Actions are projected by the page. */
@Component({
  selector: 'ui-bulk-bar',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'region', 'aria-label': 'Bulk actions' },
  template: `
    <span class="count"><strong>{{ count() }}</strong> selected</span>
    <div class="actions"><ng-content /></div>
    <button type="button" class="btn btn-ghost btn-sm clear" (click)="clear.emit()">
      <ion-icon name="close-outline" aria-hidden="true" /> Clear
    </button>
  `,
  styles: `
    :host {
      position: sticky; bottom: var(--s-4); z-index: 5;
      display: flex; align-items: center; gap: var(--s-3);
      margin-top: var(--s-4); padding: var(--s-2) var(--s-2) var(--s-2) var(--s-4);
      color: var(--brand-cream); background: var(--brand-navy-900);
      border-radius: var(--r-lg); box-shadow: var(--shadow-overlay);
    }
    .count { font-size: var(--fs-sm); white-space: nowrap; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--s-2); flex: 1; }
    .clear { color: var(--brand-cream); }
    .clear:hover { background: rgba(255, 255, 255, 0.08) !important; }
    :host ::ng-deep .btn-secondary { background: transparent; color: var(--brand-cream); border-color: rgba(255,255,255,0.25); }
    :host ::ng-deep .btn-secondary:hover { background: rgba(255,255,255,0.08); }
  `,
})
export class BulkBar {
  readonly count = input.required<number>();
  readonly clear = output<void>();
}
