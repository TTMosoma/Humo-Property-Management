import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { IMPERSONATION_REASONS, ROLE_LABELS } from '../../domain';
import { SessionService } from '../session/session.service';
import { ImpersonationService } from './impersonation.service';

/**
 * The persistent impersonation banner. Deliberately loud — it sits above the
 * whole app, can't be dismissed, and repeats who, as whom, where, in which
 * mode and why. Role switching never uses this treatment.
 */
@Component({
  selector: 'app-impersonation-banner',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-live': 'polite', '[class.act]': "imp()?.mode === 'act'" },
  template: `
    @if (imp(); as i) {
      <span class="flag"><span class="dot" aria-hidden="true"></span>Impersonation mode</span>
      <dl class="facts">
        <div><dt>Viewing as</dt><dd><strong>{{ session.identity().name }}</strong></dd></div>
        <div><dt>Role</dt><dd>{{ roleLabels[session.role()] }}</dd></div>
        <div><dt>Organisation</dt><dd>{{ session.organisation()?.shortName ?? session.assignment().label }}</dd></div>
        <div><dt>Mode</dt><dd class="mode"><ion-icon [name]="i.mode === 'act' ? 'create-outline' : 'eye-outline'" aria-hidden="true" />{{ i.mode === 'act' ? 'Act — changes are made as ' + firstName() : 'Observe — read-only' }}</dd></div>
      </dl>
      <span class="why">{{ reasons[i.reason] }}{{ i.ticket ? ' · ' + i.ticket : '' }} · {{ minutes() }} min · you are {{ session.actor().name }}</span>
      <button type="button" class="exit" (click)="exit()" [disabled]="service.busy()">
        <ion-icon name="exit-outline" aria-hidden="true" />
        Exit impersonation
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: none;
      flex-wrap: wrap;
      gap: 6px var(--s-4);
      align-items: center;
      padding: 8px var(--s-4);
      font-size: var(--fs-sm);
      color: var(--c-on-imp);
      background: var(--c-imp);
      position: relative;
      z-index: 2;
    }
    :host(.act) {
      background: repeating-linear-gradient(-45deg, var(--c-imp) 0 14px, var(--c-imp-strong) 14px 28px);
    }
    .flag {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      padding: 3px 10px;
      font-size: var(--fs-2xs);
      font-weight: var(--fw-bold);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--c-imp-strong);
      background: #fff;
      border-radius: var(--r-pill);
    }
    .dot {
      width: 8px;
      height: 8px;
      background: var(--c-imp);
      border-radius: 50%;
      animation: blink 1.6s ease-in-out infinite;
    }
    @keyframes blink { 50% { opacity: 0.25; } }
    @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
    .facts { display: flex; flex-wrap: wrap; gap: 4px var(--s-5); margin: 0; }
    .facts div { display: flex; flex-direction: column; }
    dt { font-size: 10px; font-weight: var(--fw-semibold); letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.8; }
    dd { margin: 0; font-size: var(--fs-sm); }
    dd strong { font-weight: var(--fw-bold); }
    .mode { display: inline-flex; gap: 6px; align-items: center; font-weight: var(--fw-semibold); }
    .why { font-size: var(--fs-xs); opacity: 0.9; }
    .exit {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      margin-left: auto;
      padding: 6px 14px;
      font: inherit;
      font-weight: var(--fw-bold);
      color: var(--c-imp-strong);
      background: #fff;
      border: 0;
      border-radius: var(--r);
      cursor: pointer;
    }
    .exit:hover { background: var(--brand-cream); }
    .exit:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    @media (max-width: 767px) {
      .why { display: none; }
      .exit { margin-left: 0; }
    }
  `,
})
export class ImpersonationBanner {
  protected readonly session = inject(SessionService);
  protected readonly service = inject(ImpersonationService);
  protected readonly imp = this.session.impersonation;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly reasons = IMPERSONATION_REASONS;
  protected readonly firstName = computed(() => this.session.identity().name.split(' ')[0]);

  private readonly now = signal(Date.now());
  protected readonly minutes = computed(() => {
    const i = this.imp();
    return i ? Math.max(1, Math.round((this.now() - new Date(i.startedAt).getTime()) / 60_000)) : 0;
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected exit(): void {
    this.service.exit();
  }
}
