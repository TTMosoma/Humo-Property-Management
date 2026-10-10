import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Illustration, IllustrationName } from '../illustration/illustration';

/**
 * Three different situations, three different empty states:
 * - first-use: nothing exists yet → generous, explains the value, offers to create/import
 * - filtered:  filters hide everything → compact, offers "clear filters"
 * - done:      a queue is cleared → a small reward and what to do next
 */
export type EmptyKind = 'first-use' | 'filtered' | 'done';

const DEFAULT_ART: Record<EmptyKind, IllustrationName> = {
  'first-use': 'empty-tray',
  filtered: 'no-results',
  done: 'all-done',
};

@Component({
  selector: 'ui-empty-state',
  imports: [Illustration],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'kind()' },
  template: `
    <ui-illustration [name]="art()" [size]="kind() === 'filtered' ? 96 : 150" />
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
      padding: var(--s-10) var(--s-6);
      text-align: center;
    }
    :host(.filtered) { padding: var(--s-8) var(--s-6); }
    ui-illustration { margin-bottom: var(--s-4); }
    h3 { font-size: var(--fs-lg); }
    :host(.filtered) h3 { font-size: var(--fs-md); }
    p { max-width: 440px; margin-top: var(--s-2); color: var(--c-text-muted); }
    .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--s-2); margin-top: var(--s-5); }
    .actions:empty { display: none; }
  `,
})
export class EmptyState {
  readonly kind = input<EmptyKind>('first-use');
  readonly title = input.required<string>();
  readonly message = input<string>();
  readonly illustration = input<IllustrationName>();
  protected readonly art = computed(() => this.illustration() ?? DEFAULT_ART[this.kind()]);
}
