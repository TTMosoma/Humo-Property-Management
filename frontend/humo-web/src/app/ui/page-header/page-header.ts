import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Standard page header: eyebrow, title, supporting line and right-aligned actions. */
@Component({
  selector: 'ui-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="text">
      @if (eyebrow()) {
        <div class="label-caps eyebrow">{{ eyebrow() }}</div>
      }
      <h1>{{ title() }}</h1>
      @if (subtitle()) {
        <p class="subtitle">{{ subtitle() }}</p>
      }
    </div>
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--s-4);
      padding-bottom: var(--s-6);
      margin-bottom: var(--s-6);
      border-bottom: 1px solid var(--c-border);
    }
    .eyebrow { margin-bottom: var(--s-2); }
    h1 { font-size: var(--fs-2xl); line-height: 1.2; }
    .subtitle { margin-top: var(--s-2); max-width: 720px; color: var(--c-text-muted); font-size: var(--fs-md); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .actions:empty { display: none; }
  `,
})
export class PageHeader {
  readonly eyebrow = input<string>();
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
}
