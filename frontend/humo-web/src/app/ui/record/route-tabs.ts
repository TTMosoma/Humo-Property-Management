import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

export interface RouteTab {
  label: string;
  /** Path relative to `base`, e.g. 'overview'. */
  path: string;
  count?: number;
}

/** Tabs that are real routes (deep-linkable), used under a record header. Scrolls horizontally on phones. */
@Component({
  selector: 'ui-route-tabs',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="label()">
      @for (t of tabs(); track t.path) {
        <a [routerLink]="base() + '/' + t.path" routerLinkActive="active" ariaCurrentWhenActive="page">
          {{ t.label }}
          @if (t.count) {
            <span class="count">{{ t.count }}</span>
          }
        </a>
      }
    </nav>
  `,
  styles: `
    :host { display: block; margin-bottom: var(--s-6); border-bottom: 1px solid var(--c-border); }
    nav { display: flex; gap: var(--s-1); overflow-x: auto; scrollbar-width: none; }
    a {
      position: relative; display: inline-flex; align-items: center; gap: var(--s-2);
      height: 42px; padding: 0 var(--s-3); font-size: var(--fs-sm); font-weight: var(--fw-medium);
      white-space: nowrap; color: var(--c-text-muted);
    }
    a:hover { color: var(--c-text); text-decoration: none; }
    a.active { color: var(--c-text); }
    a.active::after { content: ''; position: absolute; left: var(--s-3); right: var(--s-3); bottom: -1px; height: 2px; border-radius: 2px; background: var(--c-accent); }
    .count { min-width: 18px; height: 18px; padding: 0 5px; font-size: var(--fs-2xs); line-height: 18px; text-align: center; color: var(--c-text-2); background: var(--c-surface-sunken); border-radius: var(--r-pill); }
  `,
})
export class RouteTabs {
  readonly tabs = input.required<RouteTab[]>();
  readonly base = input.required<string>();
  readonly label = input('Sections');
}
