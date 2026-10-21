import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Subscription, map } from 'rxjs';
import { SessionDataSource, SignInError } from '../../domain';
import { HUMO_PRODUCTS } from '../../core/product/product';
import { SessionService } from '../../core/session/session.service';
import { Logo } from '../../ui/brand/logo';

type Step = 'start' | 'passkey' | 'no-passkey' | 'paused' | 'link-sent' | 'enter-code' | 'redeeming' | 'link-failed' | 'unavailable' | 'ask-trust' | 'add-passkey' | 'creating-passkey';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_AFTER_S = 30;

/** What the brand panel says. */
const STORY = {
  eyebrow: 'For managing agents and community schemes',
  headline: 'Every scheme, levy and trustee,',
  accent: 'in one place.',
  lede: 'Billing and collections, maintenance, governance and owner communication, with a full audit trail behind every decision.',
  points: [
    { icon: 'receipt-outline', text: 'Levies billed, receipted and reconciled every month' },
    { icon: 'construct-outline', text: 'Maintenance from the first report to the paid invoice' },
    { icon: 'people-outline', text: 'Trustees approve and owners stay informed' },
  ],
};

/**
 * The sign-in to Humo Property Management. Humo Contractor is a separate app
 * (projects/humo-contractor) with its own front door when it's built.
 * Passkeys first; an emailed one-time link when there's no passkey on this
 * device. It never says whether an email address has an account.
 *
 * Also the page you land on after signing out (`/signed-out`), and where a
 * sign-in link opens (`/sign-in/link?token=…`).
 *
 * In production the identity provider performs the passkey ceremony and sends
 * the links (docs/18 R-8); this page stays the branded front door.
 */
@Component({
  selector: 'app-sign-in-page',
  imports: [IonIcon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sign-in-page.html',
  styleUrl: './sign-in-page.scss',
})
export class SignInPage {
  protected readonly session = inject(SessionService);
  private readonly sessions = inject(SessionDataSource);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.queryParamMap.pipe(map((p) => ({ name: p.get('name'), returnUrl: p.get('returnUrl'), token: p.get('token') }))), {
    initialValue: { name: null, returnUrl: null, token: null },
  });
  private readonly mode = (this.route.snapshot.data['mode'] as 'sign-in' | 'signed-out' | 'link' | undefined) ?? 'sign-in';

  protected readonly product = signal(HUMO_PRODUCTS['property-management']);
  protected readonly story = signal(STORY);
  protected readonly signedOutName = computed(() => (this.mode === 'signed-out' ? (this.params().name ?? '') : null));
  protected readonly year = new Date().getFullYear();

  protected readonly step = signal<Step>(this.mode === 'link' ? 'enter-code' : 'start');
  /** Why creating a passkey after an email-link sign-in failed (not shown when they just closed the prompt). */
  protected readonly passkeyError = signal('');
  protected readonly email = signal('');
  protected readonly emailError = signal('');
  /** The email the passkey prompt was for ('' when the browser chose). */
  protected readonly passkeyFor = signal('');
  /** The six-digit code the asking screen shows; the link only works with it (entered on the page the link opens). */
  protected readonly shownCode = signal('');
  protected readonly linkCode = signal('');
  protected readonly codeError = signal('');
  protected readonly resendIn = signal(0);

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
  private pending?: Subscription;
  /** Where to go once this browser has answered "is this your own computer?" (a new link sign-in offers a passkey next). */
  private afterTrust: 'done' | 'add-passkey' = 'done';
  private timer?: ReturnType<typeof setInterval>;

  protected readonly blockedText = {
    'organisation-suspended': 'Your organisation’s access to Humo Property Management is suspended. Nothing has been deleted. Your agency’s administrator can ask Humo to reactivate it.',
    'identity-suspended': 'Your Humo sign-in is paused. Ask your agency administrator or Humo support.',
    'identity-deactivated': 'This Humo sign-in has been closed. Ask your agency administrator for a new invitation if you still need access.',
  } as const;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.pending?.unsubscribe();
      clearInterval(this.timer);
    });
    // Move focus to the new heading when the step changes, so screen readers announce it.
    let first = true;
    effect(() => {
      this.step();
      if (first) {
        first = false;
        return;
      }
      untracked(() => queueMicrotask(() => this.heading()?.nativeElement.focus()));
    });
    // A sign-in link: ask for its code (again if another link opens on this page).
    if (this.mode === 'link') {
      effect(() => {
        const token = this.params().token;
        untracked(() => this.openLink(token));
      });
    }
    afterNextRender(() => {
      if (this.mode !== 'link') this.emailInput()?.nativeElement.focus();
    });
  }

  // ---------------------------------------------------------------- Steps

  protected setEmail(e: Event): void {
    this.email.set((e.target as HTMLInputElement).value);
    this.emailError.set('');
  }

  /** Email first, then that account's passkey. */
  protected continue(): void {
    const email = this.email().trim();
    if (!EMAIL.test(email)) {
      this.emailError.set(email ? 'That doesn’t look like an email address.' : 'Enter the email address you were invited with.');
      return;
    }
    this.passkey(email);
  }

  /** The browser offers whichever passkeys it holds for Humo (no email needed). */
  protected passkey(email = ''): void {
    this.passkeyFor.set(email);
    this.step.set('passkey');
    this.pending?.unsubscribe();
    this.pending = this.sessions.signInWithPasskey(email || undefined).subscribe({
      next: (askTrust) => this.signedIn(askTrust, 'done'),
      error: (e: unknown) => {
        const code = e instanceof SignInError ? e.code : 'no-passkey';
        this.step.set(code === 'paused' ? 'paused' : code === 'cancelled' ? 'start' : code === 'unavailable' ? 'unavailable' : 'no-passkey');
      },
    });
  }

  protected cancelPasskey(): void {
    this.pending?.unsubscribe();
    this.step.set('start');
  }

  protected sendLink(): void {
    const email = (this.passkeyFor() || this.email()).trim();
    if (!EMAIL.test(email)) {
      this.step.set('start');
      this.emailError.set('Enter your email address first, and we’ll send the link there.');
      return;
    }
    this.email.set(email);
    this.pending?.unsubscribe();
    this.pending = this.sessions.sendSignInLink(email).subscribe({
      next: (code) => {
        this.shownCode.set(code);
        this.step.set('link-sent');
        this.countdown();
      },
      error: () => this.step.set('unavailable'),
    });
  }

  protected setLinkCode(e: Event): void {
    this.linkCode.set((e.target as HTMLInputElement).value);
    this.codeError.set('');
  }

  /** The code, spaced as shown (123 456), in a form that's easy to read out. */
  protected readonly spacedCode = computed(() => {
    const code = this.shownCode();
    return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
  });

  protected startOver(): void {
    this.pending?.unsubscribe();
    if (this.mode === 'link') {
      void this.router.navigate(['/sign-in'], { queryParams: { returnUrl: this.params().returnUrl ?? undefined } });
      return;
    }
    this.step.set('start');
    this.passkeyFor.set('');
    queueMicrotask(() => this.emailInput()?.nativeElement.select());
  }

  // ---------------------------------------------------------------- Helpers

  /** A sign-in link opened: nothing is signed in until the code from the asking screen is entered here. */
  private openLink(token: string | null): void {
    this.pending?.unsubscribe();
    this.linkCode.set('');
    this.codeError.set('');
    this.step.set(token ? 'enter-code' : 'link-failed');
  }

  protected submitLinkCode(): void {
    const token = this.params().token;
    const code = this.linkCode().replace(/\s/g, '');
    if (!token) {
      this.step.set('link-failed');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      this.codeError.set('Enter the six-digit code shown on the screen where you asked for the link.');
      return;
    }
    this.pending?.unsubscribe();
    this.step.set('redeeming');
    this.pending = this.sessions.completeSignInLink(token, code).subscribe({
      // Signed in by email: ask about this computer, then offer a passkey, so next time is one touch (newcomers get their first one here).
      next: (askTrust) => this.signedIn(askTrust, 'add-passkey'),
      error: (e: unknown) => {
        if (e instanceof SignInError && e.code === 'wrong-code') {
          this.codeError.set(e.message);
          this.step.set('enter-code');
          return;
        }
        this.step.set('link-failed');
      },
    });
  }

  /** Signed in: ask once whether this browser is the person's own computer, otherwise carry on. */
  private signedIn(askTrust: boolean, next: 'done' | 'add-passkey'): void {
    this.afterTrust = next;
    if (askTrust) this.step.set('ask-trust');
    else this.carryOn();
  }

  protected answerTrust(trusted: boolean): void {
    this.pending?.unsubscribe();
    // An answer that doesn't reach the server is asked again next time, so carry on either way.
    this.pending = this.sessions.answerBrowserTrust(trusted).subscribe({ complete: () => this.carryOn(), error: () => this.carryOn() });
  }

  private carryOn(): void {
    if (this.afterTrust === 'add-passkey') this.step.set('add-passkey');
    else this.done();
  }

  protected createPasskey(): void {
    this.pending?.unsubscribe();
    this.passkeyError.set('');
    this.step.set('creating-passkey');
    this.pending = this.sessions.registerPasskey().subscribe({
      next: () => this.done(),
      error: (e: unknown) => {
        this.step.set('add-passkey');
        if (!(e instanceof SignInError && e.code === 'cancelled')) {
          this.passkeyError.set('The passkey wasn’t created. You can carry on and add one later in Settings › Security.');
        }
      },
    });
  }

  private countdown(): void {
    clearInterval(this.timer);
    this.resendIn.set(RESEND_AFTER_S);
    this.timer = setInterval(() => {
      this.resendIn.update((s) => Math.max(0, s - 1));
      if (this.resendIn() === 0) clearInterval(this.timer);
    }, 1000);
  }

  /** Back to where they were going, if it's a page in this app; otherwise their home. */
  protected done(): void {
    this.session.signedInAgain();
    const back = this.params().returnUrl;
    const safe = back && back.startsWith('/') && !back.startsWith('//') && !back.startsWith('/sign');
    void this.router.navigateByUrl(safe ? back : this.session.homeRoute());
  }
}
