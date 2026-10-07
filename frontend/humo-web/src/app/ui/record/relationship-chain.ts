import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';

export interface ChainLink {
  /** What kind of thing this is: Agency, Scheme, Unit, Owner, Account, Job… */
  kind: string;
  label: string;
  route?: string;
}

/**
 * Shows a record's real parents from data (not from the URL), e.g.
 * Scheme › Unit 42 › Anele Mthembu (Owner) › Account KC-042.
 * Every part is clickable, so context is never lost however the user arrived.
 */
@Component({
  selector: 'ui-relationship-chain',
  imports: [RouterLink, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol aria-label="Related records">
      @for (l of links(); track $index; let last = $last) {
        <li>
          @if (l.route && !last) {
            <a [routerLink]="l.route"><span class="kind">{{ l.kind }}</span>{{ l.label }}</a>
          } @else {
            <span class="node" [class.current]="last"><span class="kind">{{ l.kind }}</span>{{ l.label }}</span>
          }
          @if (!last) {
            <ion-icon name="chevron-forward-outline" aria-hidden="true" />
          }
        </li>
      }
    </ol>
  `,
  styles: `
    ol { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1); margin: 0; padding: 0; list-style: none; }
    li { display: inline-flex; align-items: center; gap: var(--s-1); }
    a, .node {
      display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 var(--s-2);
      font-size: var(--fs-xs); font-weight: var(--fw-medium); color: var(--c-text-2);
      background: var(--c-surface-sunken); border-radius: var(--r);
    }
    a:hover { color: var(--c-text); background: var(--c-primary-soft); text-decoration: none; }
    .node.current { color: var(--c-primary-text); background: var(--c-primary-soft); }
    .kind { font-family: var(--font-display); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--c-text-muted); }
    ion-icon { font-size: 12px; color: var(--c-text-faint); }
  `,
})
export class RelationshipChain {
  readonly links = input.required<ChainLink[]>();
}
