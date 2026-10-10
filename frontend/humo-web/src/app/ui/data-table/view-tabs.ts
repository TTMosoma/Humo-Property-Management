import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface ViewTab {
  id: string;
  label: string;
  count?: number;
}

/** Saved views above a list ("My tasks", "Team", "Overdue", "Done"). */
@Component({
  selector: 'ui-view-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tabs" role="tablist" [attr.aria-label]="label()">
      @for (t of tabs(); track t.id) {
        <button
          type="button"
          role="tab"
          class="tab"
          [attr.aria-selected]="active() === t.id"
          (click)="active.set(t.id)"
        >
          {{ t.label }}
          @if (t.count !== undefined) {
            <span class="count">{{ t.count }}</span>
          }
        </button>
      }
    </div>
  `,
  styles: `
    :host { display: block; margin-bottom: var(--s-4); border-bottom: 1px solid var(--c-border); }
    .tabs { display: flex; gap: var(--s-1); overflow-x: auto; scrollbar-width: none; }
    .tab {
      position: relative; display: inline-flex; align-items: center; gap: var(--s-2);
      height: 40px; padding: 0 var(--s-3);
      font-size: var(--fs-sm); font-weight: var(--fw-medium); white-space: nowrap;
      color: var(--c-text-muted); background: none; border: 0; cursor: pointer;
    }
    .tab:hover { color: var(--c-text); }
    .tab[aria-selected='true'] { color: var(--c-text); }
    .tab[aria-selected='true']::after {
      content: ''; position: absolute; left: var(--s-3); right: var(--s-3); bottom: -1px;
      height: 2px; border-radius: 2px; background: var(--c-accent);
    }
    .count {
      min-width: 20px; height: 18px; padding: 0 6px; font-size: var(--fs-2xs); font-weight: var(--fw-semibold);
      line-height: 18px; text-align: center; color: var(--c-text-2); background: var(--c-surface-sunken); border-radius: var(--r-pill);
    }
    .tab[aria-selected='true'] .count { color: var(--c-on-primary); background: var(--c-primary); }
  `,
})
export class ViewTabs {
  readonly tabs = input.required<ViewTab[]>();
  readonly active = model.required<string>();
  readonly label = input('Views');
}
