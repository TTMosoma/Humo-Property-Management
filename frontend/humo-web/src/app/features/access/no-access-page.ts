import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Route, Router, RouterLink } from '@angular/router';
import { Location } from '@angular/common';
import { map } from 'rxjs';
import { ROLE_LABELS, Role } from '../../domain';
import { SessionService } from '../../core/session/session.service';
import { EmptyState } from '../../ui/states/empty-state';

/**
 * Shown in place when the current role can't open a page. If another of the
 * person's memberships can (e.g. Sipho as owner rather than trustee), it offers
 * to switch instead of leaving them stuck.
 */
@Component({
  selector: 'app-no-access-page',
  imports: [EmptyState, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="surface">
      <ui-empty-state
        illustration="no-access"
        title="You don’t have access to this page"
        [message]="message()"
      >
        @if (alternative(); as m) {
          <button type="button" class="btn btn-primary" (click)="switchTo(m.id)">Switch to {{ m.label }}</button>
        }
        <button type="button" class="btn btn-secondary" (click)="back()">Go back</button>
        <a class="btn btn-ghost" [routerLink]="session.homeRoute()">Go to home</a>
      </ui-empty-state>
    </div>
  `,
})
export class NoAccessPage {
  protected readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly from = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((p) => p.get('from') ?? '')), {
    initialValue: '',
  });

  protected readonly message = computed(() => {
    const role = ROLE_LABELS[this.session.role()];
    const admin = this.session.isResident() || this.session.role() === 'trustee' ? 'your managing agent' : 'your agency administrator';
    return `As ${role}, this page isn’t available to you. If you need it for your work, ask ${admin} to change your access.`;
  });

  /** Another membership of the same person that is allowed to open the page. */
  protected readonly alternative = computed(() => {
    const allowed = this.rolesFor(this.from());
    if (!allowed) return null;
    return this.session.memberships().find((m) => m.id !== this.session.membership().id && allowed.includes(m.role)) ?? null;
  });

  protected switchTo(id: string): void {
    this.session.switchMembership(id);
    this.router.navigateByUrl(this.from() || this.session.homeRoute());
  }

  protected back(): void {
    this.location.back();
  }

  /** Finds the deepest route roles for a URL by walking the router config. */
  private rolesFor(url: string): Role[] | null {
    const segments = url.split(/[?#]/)[0].split('/').filter(Boolean);
    let routes: Route[] | undefined = this.router.config[0]?.children;
    let roles: Role[] | null = null;
    let i = 0;
    while (routes && i <= segments.length) {
      const seg = segments[i];
      const match =
        routes.find((r) => r.path === seg) ??
        routes.find((r) => r.path?.startsWith(':')) ??
        (i === segments.length ? routes.find((r) => r.path === '') : undefined);
      if (!match) break;
      const own = match.data?.['roles'] as Role[] | undefined;
      if (own) roles = own;
      routes = match.children;
      i += match.path === '' ? 1 : (match.path?.split('/').length ?? 1);
    }
    return roles;
  }
}
