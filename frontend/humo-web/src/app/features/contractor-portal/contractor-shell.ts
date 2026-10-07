import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { PrototypeToolbar } from '../../core/prototype/prototype-toolbar';
import { ImpersonationBanner } from '../../core/security/impersonation-banner';
import { SessionService } from '../../core/session/session.service';
import { Logo } from '../../ui/brand/logo';

/**
 * Humo Contractor — its own product shell, not a section of Humo PM.
 * Different chrome (charcoal and teal, job-first navigation, bottom tabs on
 * phones). Everything under it talks only to the ContractorPortal port, so the
 * whole folder can later move into a standalone app.
 */
@Component({
  selector: 'app-contractor-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IonIcon, Logo, PrototypeToolbar, ImpersonationBanner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Impersonation looks the same in every Humo product: red banner and frame, always visible.
  host: { '[class.impersonating]': 'session.isImpersonating()' },
  template: `
    @if (session.isImpersonating()) {
      <app-impersonation-banner />
    }
    <header class="bar">
      <a class="brand" routerLink="/contractor" aria-label="Humo Contractor home">
        <ui-logo variant="mark" [reverse]="true" [height]="26" />
        <span class="name">Humo <strong>Contractor</strong></span>
      </a>
      <nav class="top-nav" aria-label="Humo Contractor">
        @for (l of links; track l.route) {
          <a [routerLink]="l.route" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: l.exact }">{{ l.label }}</a>
        }
      </nav>
      <div class="who">
        <span class="biz">{{ business() }}</span>
        <span class="avatar" [title]="session.persona().name">{{ session.persona().initials }}</span>
      </div>
    </header>
    <main class="content">
      <div class="inner"><router-outlet /></div>
    </main>
    <nav class="tabs" aria-label="Humo Contractor">
      @for (l of links; track l.route) {
        <a [routerLink]="l.route" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: l.exact }">
          <ion-icon [name]="l.icon" aria-hidden="true" />{{ l.label }}
        </a>
      }
    </nav>
    <app-prototype-toolbar />
  `,
  styles: `
    :host {
      --ct-ink: var(--brand-navy-900);
      --ct-ink-2: var(--brand-navy-800);
      --ct-accent: var(--c-accent-strong);
      --ct-accent-2: var(--brand-leaf-400);
      display: flex; flex-direction: column; height: 100%; background: var(--c-bg);
    }
    :host(.impersonating)::after { position: fixed; inset: 0; z-index: 1500; pointer-events: none; content: ''; border: 3px solid var(--c-imp); }
    .bar { display: flex; flex: none; gap: var(--s-5); align-items: center; height: 58px; padding: 0 var(--s-5); color: #e6eef4; background: var(--ct-ink); }
    .brand { display: flex; gap: 10px; align-items: center; color: inherit; text-decoration: none; }
    .name { font-family: var(--font-display); font-size: var(--fs-lg); font-weight: 400; letter-spacing: 0.01em; }
    .name strong { font-weight: 600; color: var(--ct-accent-2); }
    .top-nav { display: flex; gap: 4px; }
    .top-nav a { padding: 8px 12px; font-size: var(--fs-sm); font-weight: var(--fw-medium); color: #a9bccb; text-decoration: none; border-radius: var(--r); }
    .top-nav a:hover { color: #fff; background: var(--ct-ink-2); }
    .top-nav a.on { color: #fff; background: var(--ct-ink-2); box-shadow: inset 0 -2px 0 var(--ct-accent-2); }
    .who { display: flex; gap: var(--s-3); align-items: center; margin-left: auto; }
    .biz { font-size: var(--fs-sm); color: #a9bccb; }
    .avatar { display: grid; place-items: center; width: 32px; height: 32px; font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--ct-ink); background: var(--ct-accent-2); border-radius: 50%; }
    .content { flex: 1; min-height: 0; overflow-y: auto; }
    .inner { max-width: 1180px; margin: 0 auto; padding: var(--s-6) var(--s-5) var(--s-12); }
    .tabs { display: none; }
    @media (max-width: 767px) {
      .top-nav, .biz { display: none; }
      .bar { padding: 0 var(--s-4); }
      .inner { padding: var(--s-4) var(--s-4) 96px; }
      .tabs { display: flex; flex: none; justify-content: space-around; height: 60px; padding-bottom: env(safe-area-inset-bottom); background: var(--c-surface); border-top: 1px solid var(--c-border); }
      .tabs a { display: flex; flex-direction: column; gap: 2px; align-items: center; justify-content: center; font-size: 11px; font-weight: var(--fw-medium); color: var(--c-text-muted); text-decoration: none; }
      .tabs a ion-icon { font-size: 22px; }
      .tabs a.on { color: var(--ct-accent); }
    }
  `,
})
export class ContractorShell {
  protected readonly session = inject(SessionService);
  protected readonly business = computed(() => this.session.membership().label);
  protected readonly links = [
    { label: 'Dashboard', route: '/contractor', icon: 'speedometer-outline', exact: true },
    { label: 'Quote requests', route: '/contractor/requests', icon: 'document-text-outline', exact: false },
    { label: 'Jobs', route: '/contractor/jobs', icon: 'construct-outline', exact: false },
    { label: 'Profile', route: '/contractor/profile', icon: 'business-outline', exact: false },
  ];
}
