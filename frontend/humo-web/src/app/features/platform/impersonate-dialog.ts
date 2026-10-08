import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { IonIcon } from '@ionic/angular/standalone';
import { IMPERSONATION_REASONS, Identity, ImpersonationMode, ImpersonationReason, ROLE_LABELS, activeAssignments } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { ImpersonationService } from '../../core/security/impersonation.service';
import { organisationName, visibleOrganisations } from '../../core/session/organisations';
import { SessionService } from '../../core/session/session.service';

/**
 * Start impersonation — deliberately more than one click. The Humo staff member
 * chooses the role to view as, the mode, and why; Act mode also needs a case
 * reference, a note and step-up. Nothing free-form without audit context.
 */
@Component({
  selector: 'app-impersonate-dialog',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './impersonate-dialog.html',
  styleUrl: './impersonate-dialog.scss',
})
export class ImpersonateDialog {
  protected readonly target = inject<Identity>(DIALOG_DATA);
  private readonly ref = inject(DialogRef);
  private readonly service = inject(ImpersonationService);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);
  private readonly organisations = visibleOrganisations();

  /** Only roles the person holds today can be viewed as. */
  protected readonly assignments = activeAssignments(this.target);
  protected readonly assignmentId = signal(this.assignments[0]?.id ?? '');
  protected readonly mode = signal<ImpersonationMode>('observe');
  protected readonly reason = signal<ImpersonationReason>('support');
  protected readonly ticket = signal('');
  protected readonly note = signal('');
  protected readonly acknowledged = signal(false);
  protected readonly busy = signal(false);

  protected readonly reasons = Object.entries(IMPERSONATION_REASONS) as [ImpersonationReason, string][];
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly agencyName = computed(() => {
    const a = this.assignments.find((m) => m.id === this.assignmentId());
    return organisationName(this.organisations(), a?.scope.organisationId, 'their agency');
  });

  protected readonly noteRequired = computed(() => this.mode() === 'act' || this.reason() === 'other');
  protected readonly valid = computed(
    () =>
      !!this.assignmentId() &&
      this.acknowledged() &&
      (!this.noteRequired() || this.note().trim().length >= 10) &&
      (this.mode() === 'observe' || this.ticket().trim().length >= 3),
  );

  protected start(): void {
    if (!this.valid()) return;
    this.busy.set(true);
    this.service
      .start(
        {
          targetId: this.target.id,
          targetAssignmentId: this.assignmentId(),
          mode: this.mode(),
          reason: this.reason(),
          note: this.note().trim() || undefined,
          ticket: this.ticket().trim() || undefined,
        },
        this.target.name,
      )
      .subscribe({
        next: (started) => {
          this.busy.set(false);
          if (started) this.ref.close();
        },
        error: () => {
          this.busy.set(false);
          this.feedback.error('Impersonation didn’t start. Nothing was changed.');
        },
      });
  }

  protected cancel(): void {
    this.ref.close();
  }
}
