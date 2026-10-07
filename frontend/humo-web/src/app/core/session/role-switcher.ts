import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AccessDataSource, ROLE_LABELS, RoleAssignment } from '../../domain';
import { FeedbackService } from '../feedback/feedback.service';
import { SessionService } from './session.service';

export interface RoleChange {
  assignment: RoleAssignment;
  at: number;
}

/**
 * Switch role: same identity, different hat. The API confirms the identity
 * holds the assignment (and issues a token scoped to it) before the UI changes,
 * and records the switch in the security log.
 */
@Injectable({ providedIn: 'root' })
export class RoleSwitcher {
  private readonly session = inject(SessionService);
  private readonly access = inject(AccessDataSource);
  private readonly router = inject(Router);
  private readonly feedback = inject(FeedbackService);

  readonly switching = signal<string | null>(null);
  /** The most recent switch, for the shell's acknowledgement strip. */
  readonly lastChange = signal<RoleChange | null>(null);

  switchTo(assignmentId: string, navigateTo?: string): void {
    if (assignmentId === this.session.membership().id || this.switching()) return;
    this.switching.set(assignmentId);
    this.access.switchRole(assignmentId).subscribe({
      next: () => {
        this.switching.set(null);
        this.session.switchMembership(assignmentId);
        this.lastChange.set({ assignment: this.session.membership(), at: Date.now() });
        this.router.navigateByUrl(navigateTo ?? this.session.homeRoute());
      },
      error: () => {
        this.switching.set(null);
        const a = this.session.memberships().find((m) => m.id === assignmentId);
        this.feedback.error(`Couldn’t switch to ${a ? ROLE_LABELS[a.role] : 'that role'}. You’re still working as ${ROLE_LABELS[this.session.role()]}.`);
      },
    });
  }

  dismiss(): void {
    this.lastChange.set(null);
  }
}
