import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

/** A small, consistent status marker. Colour carries meaning; the label always says it in words too. */
@Component({
  selector: 'ui-status-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"tone-" + tone()' },
  template: `<span class="dot" aria-hidden="true"></span><span>{{ label() }}</span>`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 22px;
      padding: 0 8px;
      font-size: var(--fs-xs);
      font-weight: var(--fw-medium);
      line-height: 1;
      white-space: nowrap;
      border-radius: var(--r-pill);
      color: var(--tone-fg);
      background: var(--tone-bg);
    }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    :host(.tone-neutral) { --tone-fg: var(--c-neutral); --tone-bg: var(--c-neutral-soft); }
    :host(.tone-success) { --tone-fg: var(--c-success); --tone-bg: var(--c-success-soft); }
    :host(.tone-warning) { --tone-fg: var(--c-warning); --tone-bg: var(--c-warning-soft); }
    :host(.tone-danger)  { --tone-fg: var(--c-danger);  --tone-bg: var(--c-danger-soft); }
    :host(.tone-info)    { --tone-fg: var(--c-info);    --tone-bg: var(--c-info-soft); }
    :host(.tone-accent)  { --tone-fg: var(--c-accent-strong); --tone-bg: var(--c-accent-soft); }
  `,
})
export class StatusPill {
  readonly label = input.required<string>();
  readonly tone = input<Tone>('neutral');
}
