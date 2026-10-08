import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Identity, ROLE_LABELS, SessionDataSource, activeAssignments } from '../../domain';
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
  private readonly sessions = inject(SessionDataSource);

  protected readonly personas = toSignal(this.sessions.demoIdentities(), { initialValue: [] as Identity[] });

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
    return activeAssignments(p).map((m) => ROLE_LABELS[m.role]).join(' · ');
  }

  protected choosePersona(id: string): void {
    this.open.set(false);
    if (id === this.session.actor().id && !this.session.isImpersonating()) return;
    this.proto.viewState.set('live');
    this.sessions.signIn(id).subscribe(() => {
      this.session.signedInAgain();
      this.router.navigateByUrl(this.session.homeRoute());
    });
  }

  /**
   * The simulated state lives in the fake network, so the page has to ask
   * again: re-create the routed page so its requests go out under the new state.
   */
  protected setState(state: ViewState): void {
    this.proto.viewState.set(state);
    const url = this.router.url;
    this.router.navigateByUrl('/not-found', { skipLocationChange: true }).then(() => this.router.navigateByUrl(url));
  }
}
