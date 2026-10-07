import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { filter, map, startWith } from 'rxjs';
import { Role } from '../../../domain';
import { SessionService } from '../../session/session.service';

export interface Crumb {
  label: string;
  url: string | null;
}

/**
 * Route data contract for breadcrumbs (read from each route's OWN config, never inherited):
 * - section:    leading, non-clickable label, e.g. "Finance"
 * - breadcrumb: string, or (resolvedData, params) => string for dynamic labels like a scheme name
 */
export type BreadcrumbData = string | ((data: Record<string, unknown>, params: Record<string, string>) => string);

@Component({
  selector: 'app-breadcrumbs',
  imports: [RouterLink, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (crumbs().length > 1) {
      <nav aria-label="Breadcrumb">
        <ol>
          @for (c of crumbs(); track $index; let last = $last) {
            <li>
              @if (c.url && !last) {
                <a [routerLink]="c.url">{{ c.label }}</a>
              } @else {
                <span [attr.aria-current]="last ? 'page' : null" [class.current]="last">{{ c.label }}</span>
              }
              @if (!last) {
                <ion-icon name="chevron-forward-outline" aria-hidden="true" />
              }
            </li>
          }
        </ol>
      </nav>
    }
  `,
  styles: `
    :host { display: block; margin-bottom: var(--s-4); }
    ol { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin: 0; padding: 0; list-style: none; }
    li { display: inline-flex; align-items: center; gap: 2px; font-size: var(--fs-xs); color: var(--c-text-muted); }
    a { color: var(--c-text-muted); }
    a:hover { color: var(--c-text); }
    .current { color: var(--c-text-2); font-weight: var(--fw-medium); }
    ion-icon { font-size: 12px; color: var(--c-text-faint); }
  `,
})
export class Breadcrumbs {
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);

  protected readonly crumbs = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => this.build(this.router.routerState.snapshot.root)),
    ),
    { initialValue: [] as Crumb[] },
  );

  /** A crumb links only if the current role may open it (its own roles, or its index child's). */
  private canOpen(route: ActivatedRouteSnapshot): boolean {
    const config = route.routeConfig;
    if (!config) return false;
    const index = config.children?.find((c) => c.path === '');
    const roles = (index?.data?.['roles'] ?? config.data?.['roles']) as Role[] | undefined;
    if (!config.component && !config.loadComponent && !index) return false;
    return this.session.hasRole(roles);
  }

  private build(root: ActivatedRouteSnapshot): Crumb[] {
    const crumbs: Crumb[] = [];
    let route: ActivatedRouteSnapshot | null = root;
    while (route) {
      const own = route.routeConfig?.data ?? {};
      const url = '/' + route.pathFromRoot.flatMap((r) => r.url.map((s) => s.path)).join('/');
      if (typeof own['section'] === 'string') {
        crumbs.push({ label: own['section'], url: null });
      }
      const bc = own['breadcrumb'] as BreadcrumbData | undefined;
      if (bc) {
        const label = typeof bc === 'function' ? bc(route.data, route.params) : bc;
        const prev = crumbs[crumbs.length - 1];
        if (!prev || prev.label !== label) crumbs.push({ label, url: this.canOpen(route) ? url : null });
      }
      route = route.firstChild;
    }
    return crumbs;
  }
}
