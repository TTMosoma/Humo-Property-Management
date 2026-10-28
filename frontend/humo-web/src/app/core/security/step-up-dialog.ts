import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Subscription } from 'rxjs';
import { SENSITIVE_ACTION_LABELS, StepUpAuthenticator, StepUpMethod, StepUpRequest, StepUpResult, describeFailure } from '../../domain';
import { SessionService } from '../session/session.service';

type Phase = 'choose' | 'waiting' | 'sms' | 'verified' | 'failed';

/**
 * "Additional verification required." Calm, specific and quick: it says what is
 * being verified and why, offers the person's own device-native methods, and
 * never asks for a code from a third-party app.
 */
@Component({
  selector: 'app-step-up-dialog',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './step-up-dialog.html',
  styleUrl: './step-up-dialog.scss',
  host: { role: 'alertdialog', '[attr.aria-busy]': "phase() === 'waiting'" },
})
export class StepUpDialog {
  protected readonly request = inject<StepUpRequest>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<StepUpResult>>(DialogRef);
  private readonly auth = inject(StepUpAuthenticator);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly session = inject(SessionService);

  protected readonly actionLabel = SENSITIVE_ACTION_LABELS[this.request.action];
  private readonly all = toSignal(this.auth.methods(this.session.actor().id), { initialValue: [] });
  /** An SMS code (D26) is offered only where it's allowed (approvals), and never while impersonating. */
  protected readonly methods = computed(() => this.all().filter((m) => m.method !== 'sms' || (this.request.smsAllowed && !this.session.isImpersonating())));
  protected readonly smsSentTo = signal('');
  protected readonly smsCode = signal('');
  protected readonly smsError = signal('');
  protected readonly smsBusy = signal(false);
  protected readonly phase = signal<Phase>('choose');
  protected readonly method = signal<StepUpMethod | null>(null);
  /** Number matching for mobile approvals: stops "approve anything" fatigue attacks. */
  protected readonly matchNumber = 10 + Math.floor(Math.random() * 89);

  private pending?: Subscription;

  constructor() {
    this.destroyRef.onDestroy(() => this.pending?.unsubscribe());
  }

  protected deviceFor(m: StepUpMethod): string {
    return this.methods().find((x) => x.method === m)?.device ?? '';
  }

  protected start(m: StepUpMethod): void {
    this.method.set(m);
    if (m === 'sms') {
      this.sendSms();
      return;
    }
    this.phase.set('waiting');
    this.pending?.unsubscribe();
    this.pending = this.auth
      .verify(m, this.request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (!result.verified) {
            this.phase.set('failed');
            return;
          }
          this.phase.set('verified');
          setTimeout(() => this.ref.close(result), 650);
        },
        error: () => this.phase.set('failed'),
      });
  }

  /** D26: a code by SMS to their confirmed mobile. */
  protected sendSms(): void {
    this.smsBusy.set(true);
    this.smsError.set('');
    this.pending?.unsubscribe();
    this.pending = this.auth
      .sendSmsCode()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (to) => {
          this.smsBusy.set(false);
          this.smsSentTo.set(to);
          this.smsCode.set('');
          this.phase.set('sms');
        },
        error: (e: unknown) => {
          this.smsBusy.set(false);
          this.smsError.set(describeFailure(e, 'The code wasn’t sent'));
          this.phase.set(this.phase() === 'sms' ? 'sms' : 'choose');
        },
      });
  }

  protected setSmsCode(e: Event): void {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    this.smsCode.set(input.value);
    this.smsError.set('');
  }

  protected verifySms(): void {
    if (this.smsCode().length !== 6) {
      this.smsError.set('Enter the 6-digit code.');
      return;
    }
    this.smsBusy.set(true);
    this.pending?.unsubscribe();
    this.pending = this.auth
      .verifySmsCode(this.smsCode())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.smsBusy.set(false);
          this.phase.set('verified');
          setTimeout(() => this.ref.close(result), 650);
        },
        error: (e: unknown) => {
          this.smsBusy.set(false);
          this.smsError.set(describeFailure(e, 'That code didn’t work'));
        },
      });
  }

  protected retry(): void {
    this.phase.set('choose');
    this.method.set(null);
  }

  protected cancel(): void {
    this.pending?.unsubscribe();
    this.ref.close({ verified: false, at: new Date().toISOString() });
  }

  protected setUp(): void {
    this.cancel();
    this.router.navigateByUrl('/settings/security');
  }
}
