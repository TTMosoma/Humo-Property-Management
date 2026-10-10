import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import {
  AuditDataSource,
  AuditEvent,
  Permission,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  SENSITIVE_ACTION_LABELS,
  SecurityDataSource,
  SecurityProfile,
  SensitiveAction,
} from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { StepUpService } from '../../core/security/step-up.service';
import { SessionService } from '../../core/session/session.service';
import { formatDate } from '../../ui/format/money';
import { relativeTime } from '../../ui/format/relative-time';
import { PageHeader } from '../../ui/page-header/page-header';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';

/**
 * Settings › Security: the signed-in identity's own credentials. Passkeys and
 * Humo Mobile — device-native, first-party — instead of codes from a
 * third-party authenticator app. Every change here needs a fresh step-up.
 */
@Component({
  selector: 'app-security-page',
  imports: [PageHeader, StatusPill, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './security-page.html',
  styleUrl: './security-page.scss',
})
export class SecurityPage {
  private readonly data = inject(SecurityDataSource);
  private readonly audit = inject(AuditDataSource);
  private readonly stepUp = inject(StepUpService);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);

  /** Always the human at the keyboard — never the impersonated user. */
  private readonly identityId = computed(() => this.session.actor().id);

  protected readonly result = loadable(() => this.data.profile(this.identityId()).pipe(map((profile) => ({ profile }))));
  protected readonly activity = toSignal(
    toObservable(this.identityId).pipe(
      switchMap((id) =>
        this.audit.query({ organisationId: null, identityId: id, category: 'security' }, { pageSize: 20 }).pipe(
          map((p) => p.items),
          catchError(() => of([] as AuditEvent[])),
        ),
      ),
      map((events) => events.filter((e) => e.actor.identityId === this.identityId()).slice(0, 6)),
    ),
    { initialValue: [] as AuditEvent[] },
  );

  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  protected readonly profile = computed(() => this.result.value()?.profile ?? null);
  protected readonly otherSessions = computed(() => (this.profile()?.sessions ?? []).filter((s) => !s.current).length);

  /** Only the sensitive actions this person could ever perform, across all their roles. */
  protected readonly sensitive = computed<SensitiveAction[]>(() => {
    // The actor's own permissions across every role they hold, as the server reported them.
    const held = { has: (p: Permission) => this.session.actorCan(p) };
    const needs: [SensitiveAction, Permission | null][] = [
      ['release-payment', 'Payables.Release'],
      ['approve-large-amount', 'Approvals.Decide'],
      ['change-bank-details', 'Suppliers.ChangeBankDetails'],
      ['change-roles', 'Users.Manage'],
      ['add-administrator', 'Users.ManageAdmins'],
      ['export-data', 'Finance.Export'],
      ['impersonate-act', 'System.Impersonate'],
      ['change-security', null],
    ];
    return needs.filter(([, p]) => !p || held.has(p)).map(([a]) => a);
  });
  protected readonly sensitiveLabels = SENSITIVE_ACTION_LABELS;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly formatDate = formatDate;
  protected readonly relativeTime = relativeTime;

  protected readonly fresh = computed(() => {
    this.session.stepUpProof();
    return this.session.stepUpFresh();
  });

  protected addPasskey(): void {
    const id = this.identityId();
    const name = this.session.isHumo() ? 'Studio laptop (new)' : 'This device';
    this.run('Add a passkey for this device (Windows Hello)', () => this.data.addPasskey(id, name, 'Windows Hello'), 'Passkey added. You can now use Windows Hello on this device.');
  }

  protected removePasskey(passkeyId: string, name: string): void {
    const p = this.profile();
    if (p && p.passkeys.length === 1 && !p.devices.some((d) => d.humoMobile)) {
      this.feedback.error('Keep at least one way to verify — add another passkey or set up Humo Mobile first.');
      return;
    }
    this.run(`Remove the passkey “${name}”`, () => this.data.removePasskey(this.identityId(), passkeyId), `Removed “${name}”.`);
  }

  protected removeDevice(deviceId: string, name: string): void {
    this.run(`Remove ${name} from your trusted devices`, () => this.data.removeDevice(this.identityId(), deviceId), `${name} is no longer trusted. It will need to verify again to sign in.`);
  }

  protected signOut(sessionId: string, device: string): void {
    this.run(`Sign out ${device}`, () => this.data.signOutSession(this.identityId(), sessionId), `Signed out ${device}.`);
  }

  protected signOutOthers(): void {
    this.run('Sign out every other session', () => this.data.signOutOtherSessions(this.identityId()), 'Signed out of every other device. This one stays signed in.');
  }

  private run(detail: string, action: () => Observable<void>, done: string): void {
    this.stepUp.guard({ action: 'change-security', detail }, action).subscribe({
      next: () => this.feedback.success(done),
      error: () => this.feedback.error('That change didn’t save. Nothing was changed.'),
    });
  }
}
