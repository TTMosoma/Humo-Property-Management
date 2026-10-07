import { inject } from '@angular/core';
import { CanActivateChildFn, RedirectCommand, Router } from '@angular/router';
import { Feature, Role } from '../../domain';
import { SessionService } from '../session/session.service';

/**
 * Checks each route's own `data.roles` and `data.feature` (not inherited)
 * against the active role and the agency's plan. Runs for every level of the
 * route tree under the shell.
 *
 * Denied pages render "You don't have access" in place: the URL stays as typed,
 * so the user knows what they asked for and can share it with someone who can help.
 *
 * This is UX gating only. The .NET API enforces role permissions, scope and
 * entitlements on every request — hiding a page protects nothing by itself.
 */
export const roleGuard: CanActivateChildFn = (child, state) => {
  const session = inject(SessionService);
  const roles = child.routeConfig?.data?.['roles'] as Role[] | undefined;
  const feature = child.routeConfig?.data?.['feature'] as Feature | undefined;
  const entitled = !feature || session.hasFeature(feature);
  if (session.hasRole(roles) && entitled) return true;

  const router = inject(Router);
  const target = router.createUrlTree(['/no-access'], {
    queryParams: { from: state.url, ...(entitled ? {} : { reason: 'plan', feature }) },
  });
  return new RedirectCommand(target, { skipLocationChange: true });
};
