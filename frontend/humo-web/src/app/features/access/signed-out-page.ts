import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { ROLE_LABELS } from '../../domain';
import { HUMO_PRODUCTS, HumoProductId } from '../../core/product/product';
import { SessionService } from '../../core/session/session.service';
import { Logo } from '../../ui/brand/logo';

/**
 * "You've signed out of Humo." A Humo identity screen (not a product screen):
 * the same page whichever Humo product you left, offering to sign back in
 * to that product. Passkey sign-in is simulated in the prototype.
 */
@Component({
  selector: 'app-signed-out-page',
  imports: [IonIcon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <section class="card">
        <ui-logo variant="wordmark" [height]="30" />
        <span class="ok" aria-hidden="true"><ion-icon name="checkmark-outline" /></span>
        <h1>You’ve signed out of Humo{{ name() ? ', ' + name() : '' }}</h1>
        <p class="lede">
          Your Humo session has ended on this device — in {{ product().name }} and every other Humo product.
          Anyone using this device next will need to sign in again.
        </p>

        @if (signingIn()) {
          <div class="waiting" role="status"><span class="spinner" aria-hidden="true"></span> Waiting for your passkey…</div>
        } @else {
          <button type="button" class="btn btn-primary big" (click)="signInAgain()">
            <ion-icon name="finger-print-outline" aria-hidden="true" /> Sign in to {{ product().name }}
          </button>
          @if (product().id !== 'property-management') {
            <button type="button" class="link" (click)="signInAgain('property-management')">Sign in to Humo Property Management instead</button>
          }
        }

        <details class="proto">
          <summary>Prototype: sign in as someone else</summary>
          <ul>
            @for (p of session.personas(); track p.id) {
              <li>
                <button type="button" (click)="signInAs(p.id)">
                  <span class="av">{{ p.initials }}</span>
                  <span class="who"><strong>{{ p.name }}</strong><span>{{ rolesOf(p.memberships) }}</span></span>
                </button>
              </li>
            }
          </ul>
        </details>
      </section>
      <p class="foot">Humo · {{ product().name }}</p>
    </main>
  `,
  styles: `
    :host { display: block; min-height: 100%; background: var(--c-bg); }
    .wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: var(--s-6) var(--s-4); }
    .card {
      display: flex; flex-direction: column; align-items: center; gap: var(--s-3); width: min(440px, 100%);
      padding: var(--s-8) var(--s-6); text-align: center; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-lg); box-shadow: var(--shadow-md);
    }
    .ok { display: grid; place-items: center; width: 44px; height: 44px; margin-top: var(--s-4); font-size: 22px; color: var(--c-success); background: var(--c-success-soft); border-radius: 50%; }
    h1 { font-size: var(--fs-xl); }
    .lede { margin: 0 0 var(--s-3); font-size: var(--fs-sm); color: var(--c-text-muted); }
    .big { width: 100%; min-height: 44px; justify-content: center; }
    .link { padding: 0; font: inherit; font-size: var(--fs-sm); color: var(--c-primary-text); text-decoration: underline; background: none; border: 0; cursor: pointer; }
    .waiting { display: flex; gap: var(--s-2); align-items: center; padding: var(--s-3); font-size: var(--fs-sm); color: var(--c-text-2); }
    .spinner { width: 18px; height: 18px; border: 2px solid var(--c-primary-soft); border-top-color: var(--c-primary); border-radius: 50%; animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .proto { width: 100%; margin-top: var(--s-4); text-align: left; font-size: var(--fs-sm); border-top: 1px dashed var(--c-border); padding-top: var(--s-3); }
    .proto summary { cursor: pointer; color: var(--c-text-muted); }
    .proto ul { margin: var(--s-2) 0 0; padding: 0; list-style: none; max-height: 260px; overflow-y: auto; }
    .proto li button { display: flex; gap: var(--s-3); align-items: center; width: 100%; padding: 6px; text-align: left; color: inherit; background: none; border: 0; border-radius: var(--r); cursor: pointer; font: inherit; }
    .proto li button:hover { background: var(--c-surface-hover); }
    .av { display: grid; flex: none; place-items: center; width: 28px; height: 28px; font-size: var(--fs-2xs); font-weight: var(--fw-semibold); background: var(--c-surface-sunken); border-radius: 50%; }
    .who { display: flex; flex-direction: column; min-width: 0; }
    .who span { overflow: hidden; font-size: var(--fs-xs); color: var(--c-text-muted); white-space: nowrap; text-overflow: ellipsis; }
    .foot { margin-top: var(--s-4); font-size: var(--fs-xs); color: var(--c-text-faint); }
  `,
})
export class SignedOutPage {
  protected readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((p) => ({ product: p.get('product'), name: p.get('name') }))));

  protected readonly product = computed(() => HUMO_PRODUCTS[(this.params()?.product as HumoProductId) ?? 'property-management'] ?? HUMO_PRODUCTS['property-management']);
  protected readonly name = computed(() => this.params()?.name ?? '');
  protected readonly signingIn = signal(false);

  protected rolesOf(m: { role: keyof typeof ROLE_LABELS }[]): string {
    return m.map((x) => ROLE_LABELS[x.role]).join(' · ');
  }

  /** Simulated passkey sign-in, back to the product they came from. */
  protected signInAgain(target?: HumoProductId): void {
    this.signingIn.set(true);
    setTimeout(() => {
      this.session.signIn();
      this.go(target ?? this.product().id);
    }, 900);
  }

  protected signInAs(id: string): void {
    this.session.signIn(id);
    this.go(this.product().id);
  }

  /** The role decides which product is home (a contractor's is Humo Contractor). */
  private go(product: HumoProductId): void {
    void product;
    this.router.navigateByUrl(this.session.homeRoute());
  }
}
