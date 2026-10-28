import { inject } from '@angular/core';
import { CanActivateChildFn, RedirectCommand, Router } from '@angular/router';
import { Feature, Permission } from '../../domain';
import { SessionService } from '../session/session.service';
import { NOT_CONNECTED, notConnected } from '../availability/not-connected';

/**
 * Checks each route's own `data.permission` and `data.feature` (not inherited)
 * against what the active assignment may open and what the organisation's plan
 * includes. Runs for every level of the route tree under the shell. Roles never
 * appear here: if roles become configurable profiles, routes don't change.
 *
 * Denied pages render "You don't have access" in place: the URL stays as typed,
 * so the user knows what they asked for and can share it with someone who can help.
 *
 * This is UX gating only. The .NET API enforces permissions, scope and
 * entitlements on every request — hiding a page protects nothing by itself.
 */
export const accessGuard: CanActivateChildFn = (child, state) => {
  // A screen not on Humo's API yet says so, in place, rather than failing (docs/28 §1).
  if (notConnected(inject(NOT_CONNECTED), state.url) && !state.url.startsWith('/coming-soon')) {
    return new RedirectCommand(inject(Router).createUrlTree(['/coming-soon'], { queryParams: { from: state.url } }), { skipLocationChange: true });
  }
  const session = inject(SessionService);
  const permission = child.routeConfig?.data?.['permission'] as Permission | undefined;
  const feature = child.routeConfig?.data?.['feature'] as Feature | undefined;
  const entitled = !feature || session.hasFeature(feature);
  if ((!permission || session.canOpen(permission)) && entitled) return true;

  const router = inject(Router);
  const target = router.createUrlTree(['/no-access'], {
    queryParams: { from: state.url, ...(entitled ? {} : { reason: 'plan', feature }) },
  });
  return new RedirectCommand(target, { skipLocationChange: true });
};
