import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { Observable, Subscription } from 'rxjs';
import { PASSKEY_TOOLS, PasskeyTool, PasskeyToolOption, SignInError } from '../../domain';
import { StepUpService } from '../../core/security/step-up.service';
import { SessionService } from '../../core/session/session.service';

type Phase = 'choose' | 'waiting' | 'confirming' | 'confirmed';

/** A failure in words: what happened, and what the person can do about it. */
export interface PasskeyProblem {
  title: string;
  detail: string;
}

const LOST =
  'If you’ve lost your passkey, Humo Support can remove it after checking it’s you; then you can add a new one.';

/** What went wrong with creating a passkey, for a message that stays on screen until the person dismisses it. */
export function passkeyProblem(error: unknown, tool?: PasskeyToolOption): PasskeyProblem {
  const nothing = 'Nothing was changed.';
  switch (error instanceof SignInError ? error.code : null) {
    case 'cancelled':
      return {
        title: 'The passkey wasn’t created',
        detail: `The prompt was closed or timed out. ${nothing} ${tool?.id === 'device' ? 'If no prompt appeared, this device’s screen lock may not be set up: set it up, or choose another option below.' : 'Try again, or choose another option below.'}`,
      };
    case 'passkey-exists':
      return {
        title: `${tool?.label ?? 'This'} already has a passkey for your account`,
        detail: `You can use it to sign in as it is. ${nothing} To add another, choose a different option below.`,
      };
    case 'passkey-unsupported':
      return {
        title: 'This browser or device can’t create that passkey',
        detail: `${nothing} Choose another option below, or update your browser and try again.`,
      };
    case 'unavailable':
      return { title: 'Humo can’t be reached right now', detail: `${nothing} Check your connection and try again.` };
    default:
      return {
        title: 'Humo didn’t accept that passkey',
        detail: `${nothing} Try again, or choose another option below. If it keeps happening, contact Humo Support.`,
      };
  }
}

/**
 * Adding a passkey (D30): says why Humo is careful about it, lets the person choose where the passkey
 * lives, confirms with an existing passkey when the API asks for one, and keeps any failure on screen.
 * The API decides whether a confirmation is needed, so this asks it by trying.
 */
@Component({
  selector: 'app-passkey-setup',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './passkey-setup.html',
  styleUrl: './passkey-setup.scss',
})
export class PasskeySetup {
  /** Creates the passkey in the chosen tool. */
  readonly create = input.required<(tool: PasskeyTool) => Observable<void>>();
  readonly added = output<PasskeyToolOption>();

  private readonly stepUp = inject(StepUpService);
  private readonly session = inject(SessionService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly tools = PASSKEY_TOOLS;
  protected readonly phase = signal<Phase>('choose');
  protected readonly tool = signal<PasskeyToolOption | null>(null);
  protected readonly problem = signal<PasskeyProblem | null>(null);

  private pending?: Subscription;

  constructor() {
    this.destroyRef.onDestroy(() => this.pending?.unsubscribe());
  }

  protected choose(tool: PasskeyToolOption): void {
    this.tool.set(tool);
    this.problem.set(null);
    this.phase.set('waiting');
    this.pending?.unsubscribe();
    this.pending = this.create()(tool.id).subscribe({
      next: () => {
        this.phase.set('choose');
        this.added.emit(tool);
      },
      error: (e: unknown) => {
        if (e instanceof SignInError && e.code === 'passkey-verify') {
          this.confirm(tool);
          return;
        }
        this.fail(passkeyProblem(e, tool));
      },
    });
  }

  /** The API wants a fresh proof. Afterwards the person presses again: browsers open the passkey prompt only straight after a press. */
  private confirm(tool: PasskeyToolOption): void {
    this.phase.set('confirming');
    this.session.stepUpProof.set(null);
    this.pending = this.stepUp.require({ action: 'change-security', detail: `Add a passkey: ${tool.label}` }).subscribe({
      next: (ok) => {
        if (ok) this.phase.set('confirmed');
        else this.fail({ title: 'We couldn’t confirm it’s you', detail: `The passkey wasn’t added. Someone who already has a passkey must confirm with it first. ${LOST}` });
      },
      error: () => this.fail({ title: 'We couldn’t confirm it’s you', detail: `The passkey wasn’t added. ${LOST}` }),
    });
  }

  protected back(): void {
    this.problem.set(null);
    this.phase.set('choose');
  }

  protected dismiss(): void {
    this.problem.set(null);
  }

  private fail(problem: PasskeyProblem): void {
    this.problem.set(problem);
    this.phase.set('choose');
  }
}
