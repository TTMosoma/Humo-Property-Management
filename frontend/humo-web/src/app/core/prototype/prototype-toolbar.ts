import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Identity, ROLE_LABELS } from '../../domain';
import { PlatformStore } from '../../mock/db/platform-store';
import { SessionService } from '../session/session.service';
import { PrototypeStateService, ViewState } from './prototype-state.service';

/**
 * Floating review panel: switch persona/role and force page states.
 * Prototype-only: remove together with core/prototype when the backend exists.
 */
@Component({
  selector: 'app-prototype-toolbar',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './prototype-toolbar.html',
  styleUrl: './prototype-toolbar.scss',
})
export class PrototypeToolbar {
  protected readonly session = inject(SessionService);
  protected readonly proto = inject(PrototypeStateService);
  private readonly router = inject(Router);
  private readonly platform = inject(PlatformStore);

  protected readonly open = signal(false);
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly states: { value: ViewState; label: string }[] = [
    { value: 'live', label: 'Live' },
    { value: 'loading', label: 'Loading' },
    { value: 'empty', label: 'Empty' },
    { value: 'error', label: 'Error' },
  ];

  /** Nudges remember being seen or dismissed; this lets a reviewer see them again. */
  protected resetNudges(): void {
    this.platform.resetNudges();
    this.open.set(false);
  }

  protected rolesOf(p: Identity): string {
    return p.memberships.map((m) => ROLE_LABELS[m.role]).join(' · ');
  }

  protected choosePersona(id: string): void {
    this.open.set(false);
    if (id === this.session.actor().id && !this.session.isImpersonating()) return;
    this.session.switchPersona(id);
    this.proto.viewState.set('live');
    this.router.navigateByUrl(this.session.homeRoute());
  }
}
