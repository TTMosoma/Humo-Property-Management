import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AccessDataSource, fieldErrorsOf } from '../../domain';

/**
 * D34: the link from a new email address. It asks before changing anything, because mail
 * scanners open links, and it needs no session, because they may have lost the old address.
 */
@Component({
  selector: 'app-confirm-email-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      <section class="surface card">
        @if (confirmed(); as email) {
          <h1>Your email is changed</h1>
          <p>Humo Property Management now uses <strong>{{ email }}</strong>. You’ve been signed out on other devices, and your passkeys still work. If you hadn’t accepted your invitation yet, a new one is on its way to this address.</p>
          <a class="btn btn-primary" routerLink="/sign-in">Sign in</a>
        } @else if (failure(); as why) {
          <h1>This link can’t be used</h1>
          <p role="alert">{{ why }}</p>
        } @else {
          <h1>Confirm your new email</h1>
          <p>Choose <em>Confirm</em> to use this address for Humo Property Management. Your statements and sign-in links will come here from now on.</p>
          <button type="button" class="btn btn-primary" [disabled]="busy() || !token()" (click)="confirm()">Confirm</button>
        }
      </section>
    </main>
  `,
  styles: `
    .page { display: grid; min-height: 100vh; place-items: center; padding: var(--s-4); background: var(--c-bg); }
    .card { width: 100%; max-width: 460px; padding: var(--s-6); }
    h1 { margin: 0 0 var(--s-3); font-size: var(--fs-xl); }
    p { margin: 0 0 var(--s-4); }
  `,
})
export class ConfirmEmailPage {
  private readonly access = inject(AccessDataSource);
  private readonly route = inject(ActivatedRoute);

  protected readonly token = computed(() => this.route.snapshot.queryParamMap.get('token') ?? '');
  protected readonly busy = signal(false);
  protected readonly confirmed = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected confirm(): void {
    this.busy.set(true);
    this.access.confirmEmailChange(this.token()).subscribe({
      next: (email) => this.confirmed.set(email),
      error: (e) => {
        this.busy.set(false);
        this.failure.set(fieldErrorsOf(e)['token'] ?? 'We couldn’t confirm that just now. Try the link again in a moment.');
      },
    });
  }
}
