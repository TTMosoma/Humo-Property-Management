import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CatalogueService } from '../../core/catalogue/catalogue.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Route, Router, RouterLink } from '@angular/router';
import { Location } from '@angular/common';
import { Feature, Permission, ROLE_LABELS, ROLE_PERMISSIONS } from '../../domain';
import { RoleSwitcher } from '../../core/session/role-switcher';
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
        [illustration]="planFeature() ? 'coming-soon' : 'no-access'"
        [title]="planFeature() ? featureLabel() + ' — not included in your current plan' : 'You don’t have access to this page'"
        [message]="message()"
      >
        @if (planFeature(); as f) {
          @if (session.can('Subscription.Request')) {
            <a class="btn btn-primary" routerLink="/settings/plan" [queryParams]="{ feature: f }">Request upgrade</a>
          }
          <a class="btn btn-secondary" routerLink="/settings/plan" [queryParams]="{ feature: f }">See your plan</a>
        } @else if (alternative(); as m) {
          <button type="button" class="btn btn-primary" (click)="switchTo(m.id)">Switch role to {{ roleLabels[m.role] }}</button>
        }
        <button type="button" class="btn btn-secondary" (click)="back()">Go back</button>
        <a class="btn btn-ghost" [routerLink]="session.homeRoute()">Go to home</a>
      </ui-empty-state>
    </div>
  `,
})
export class NoAccessPage {
  protected readonly catalogue = inject(CatalogueService);
  protected readonly session = inject(SessionService);
  private readonly switcher = inject(RoleSwitcher);
  private readonly router = inject(Router);
  protected readonly roleLabels = ROLE_LABELS;
  private readonly location = inject(Location);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);
  private readonly from = computed(() => this.params()?.get('from') ?? '');
  protected readonly featureLabel = computed(() => {
    const f = this.planFeature();
    return f ? this.catalogue.featureLabel(f) : '';
  });
  protected readonly planFeature = computed(() => this.params()?.get('feature') as Feature | null);

  protected readonly message = computed(() => {
    const feature = this.planFeature();
    if (feature) {
      const what = this.catalogue.feature(feature)?.description ?? '';
      const who = this.session.can('Subscription.Request') ? 'You can ask your Humo account manager about adding it — nothing changes until you agree.' : 'Your agency administrator can ask Humo about adding it.';
      return `${what} ${who}`.trim();
    }
    const role = ROLE_LABELS[this.session.role()];
    const admin = this.session.isHumo()
      ? 'a Humo System Administrator'
      : this.session.isResident() || this.session.role() === 'trustee'
        ? 'your managing agent'
        : 'your agency administrator';
    return `As ${role}, this page isn’t available to you. If you need it for your work, ask ${admin} to change your access.`;
  });

  /**
   * Another of the person's roles that can open the page. Worked out from the
   * published role → permission table, which the client keeps for explanations;
   * the switch itself is checked by the API.
   */
  protected readonly alternative = computed(() => {
    const needed = this.permissionFor(this.from());
    if (!needed || this.planFeature()) return null;
    return (
      this.session
        .assignments()
        .find((m) => m.id !== this.session.assignment().id && (ROLE_PERMISSIONS[m.role].includes(needed) || !!m.grants?.includes(needed))) ?? null
    );
  });

  protected switchTo(id: string): void {
    this.switcher.switchTo(id, this.from() || undefined);
  }

  protected back(): void {
    this.location.back();
  }

  /** Finds the deepest route permission for a URL by walking the router config. */
  private permissionFor(url: string): Permission | null {
    const segments = url.split(/[?#]/)[0].split('/').filter(Boolean);
    let routes: Route[] | undefined = this.router.config.find((r) => r.path === '' && r.children)?.children;
    let permission: Permission | null = null;
    let i = 0;
    while (routes && i <= segments.length) {
      const seg = segments[i];
      const match =
        routes.find((r) => r.path === seg) ??
        routes.find((r) => r.path?.startsWith(':')) ??
        (i === segments.length ? routes.find((r) => r.path === '') : undefined);
      if (!match) break;
      const own = match.data?.['permission'] as Permission | undefined;
      if (own) permission = own;
      routes = match.children;
      i += match.path === '' ? 1 : (match.path?.split('/').length ?? 1);
    }
    return permission;
  }
}
