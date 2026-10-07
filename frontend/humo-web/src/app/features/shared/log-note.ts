import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { TimelineDataSource } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { SessionService } from '../../core/session/session.service';

/**
 * Log a call or note against a unit and/or person. When an owner phones,
 * the agent records what was discussed in the same place as the money and
 * maintenance history — so the next person who takes a call has the context.
 */
@Component({
  selector: 'app-log-note',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[hidden]': "!session.can('Notes.Add')" },
  template: `
    <form (submit)="save($event)">
      <div class="kinds" role="radiogroup" aria-label="Type of entry">
        <button type="button" role="radio" [attr.aria-checked]="kind() === 'call'" (click)="kind.set('call')">
          <ion-icon name="call-outline" aria-hidden="true" /> Call
        </button>
        <button type="button" role="radio" [attr.aria-checked]="kind() === 'note'" (click)="kind.set('note')">
          <ion-icon name="create-outline" aria-hidden="true" /> Note
        </button>
      </div>
      <label class="visually-hidden" [for]="id">{{ kind() === 'call' ? 'What was discussed' : 'Note' }}</label>
      <textarea
        [id]="id"
        rows="3"
        [placeholder]="kind() === 'call' ? 'What did they call about, and what did you agree?' : 'Add a note for the team…'"
        [value]="text()"
        (input)="text.set($any($event.target).value)"
      ></textarea>
      <div class="actions">
        <span class="hint">Visible to agency staff only.</span>
        <button type="submit" class="btn btn-primary btn-sm" [disabled]="!text().trim() || busy()">
          {{ kind() === 'call' ? 'Log call' : 'Add note' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    form { display: flex; flex-direction: column; gap: var(--s-2); }
    .kinds { display: inline-flex; align-self: flex-start; padding: 2px; background: var(--c-surface-sunken); border-radius: var(--r); }
    .kinds button {
      display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 var(--s-3);
      font-size: var(--fs-xs); font-weight: var(--fw-medium); color: var(--c-text-2); background: none; border: 0; border-radius: var(--r-sm); cursor: pointer;
    }
    .kinds button[aria-checked='true'] { color: var(--c-text); background: var(--c-surface); box-shadow: var(--shadow-sm); }
    textarea {
      width: 100%; padding: var(--s-2) var(--s-3); font: inherit; color: var(--c-text);
      background: var(--c-surface); border: 1px solid var(--c-border-strong); border-radius: var(--r); resize: vertical;
    }
    textarea:focus { border-color: var(--c-focus); outline: none; box-shadow: 0 0 0 3px var(--c-accent-soft); }
    .actions { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
    .hint { font-size: var(--fs-xs); color: var(--c-text-faint); }
  `,
})
export class LogNote {
  private readonly timeline = inject(TimelineDataSource);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);

  readonly unitId = input<string>();
  readonly personId = input<string>();
  readonly saved = output<void>();

  protected readonly id = `note-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly kind = signal<'call' | 'note'>('call');
  protected readonly text = signal('');
  protected readonly busy = signal(false);

  protected save(e: Event): void {
    e.preventDefault();
    const text = this.text().trim();
    if (!text) return;
    this.busy.set(true);
    this.timeline.addNote({ unitId: this.unitId(), personId: this.personId(), kind: this.kind(), text }).subscribe({
      next: () => {
        this.busy.set(false);
        this.text.set('');
        this.feedback.success(this.kind() === 'call' ? 'Call logged' : 'Note added');
        this.saved.emit();
      },
      error: () => {
        this.busy.set(false);
        this.feedback.error('Couldn’t save — your text is still here. Try again.');
      },
    });
  }
}
