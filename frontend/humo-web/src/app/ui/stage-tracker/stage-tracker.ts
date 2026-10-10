import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';

export interface StageDef {
  id: string;
  label: string;
}

/**
 * Workflow tracker (pattern P3): where a record is in its lifecycle, what is
 * done and what comes next. One definition per workflow (jobs, billing runs,
 * meetings, collections); the tracker itself is generic.
 */
@Component({
  selector: 'ui-stage-tracker',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.compact]': 'compact()', '[class.alert]': 'alert()' },
  template: `
    <ol [attr.aria-label]="label()">
      @for (s of view(); track s.id; let last = $last) {
        <li [class]="s.state" [attr.aria-current]="s.state === 'current' ? 'step' : null">
          <span class="marker">
            @if (s.state === 'done') {
              <ion-icon name="checkmark-outline" aria-hidden="true" />
            } @else if (s.state === 'current' && alert()) {
              <ion-icon name="alert-circle-outline" aria-hidden="true" />
            } @else {
              <span class="dot"></span>
            }
          </span>
          <span class="label">{{ s.label }}</span>
          @if (!last) {
            <span class="line" aria-hidden="true"></span>
          }
        </li>
      }
    </ol>
  `,
  styles: `
    :host { display: block; overflow-x: auto; scrollbar-width: thin; }
    ol { display: flex; min-width: max-content; margin: 0; padding: var(--s-1) 0; list-style: none; }
    li { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 76px; flex: 1; }
    .marker {
      position: relative; z-index: 1; display: grid; place-items: center; width: 26px; height: 26px;
      font-size: 14px; border-radius: 50%; background: var(--c-surface); border: 2px solid var(--c-border-strong); color: var(--c-text-faint);
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: 0.5; }
    .label { font-size: var(--fs-xs); color: var(--c-text-muted); white-space: nowrap; }
    .line { position: absolute; top: 12px; left: calc(50% + 15px); right: calc(-50% + 15px); height: 2px; background: var(--c-border); }
    li.done .marker { color: var(--c-on-primary); background: var(--c-accent); border-color: var(--c-accent); }
    li.done .line { background: var(--c-accent); }
    li.done .label { color: var(--c-text-2); }
    li.current .marker { color: var(--c-accent-strong); border-color: var(--c-accent); box-shadow: 0 0 0 4px var(--c-accent-soft); }
    li.current .dot { opacity: 1; width: 10px; height: 10px; }
    li.current .label { color: var(--c-text); font-weight: var(--fw-semibold); }
    :host(.alert) li.current .marker { color: var(--c-danger); border-color: var(--c-danger); box-shadow: 0 0 0 4px var(--c-danger-soft); }
    :host(.compact) li { min-width: 58px; }
    :host(.compact) .label { font-size: 10px; }
  `,
})
export class StageTracker {
  readonly stages = input.required<StageDef[]>();
  readonly current = input.required<string>();
  /** The current stage is overdue or blocked. */
  readonly alert = input(false);
  readonly compact = input(false);
  readonly label = input('Progress');

  protected readonly view = computed(() => {
    const idx = this.stages().findIndex((s) => s.id === this.current());
    return this.stages().map((s, i) => ({ ...s, state: i < idx ? 'done' : i === idx ? 'current' : 'upcoming' }));
  });
}
