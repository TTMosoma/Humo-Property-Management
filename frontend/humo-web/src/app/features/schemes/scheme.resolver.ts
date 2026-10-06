import { inject } from '@angular/core';
import { CanActivateFn, ResolveFn, Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { Scheme, SchemeDataSource } from '../../domain';
import { SessionService } from '../../core/session/session.service';

export const schemeResolver: ResolveFn<Scheme | undefined> = (route) =>
  inject(SchemeDataSource)
    .get(route.paramMap.get('schemeId')!)
    .pipe(catchError(() => of(undefined)));

/** Personas linked to specific schemes (portfolio managers, trustees) may only open those schemes. */
export const schemeAccessGuard: CanActivateFn = (route) => {
  const session = inject(SessionService);
  const allowed = session.persona().schemeIds;
  const id = route.paramMap.get('schemeId')!;
  if (allowed.length === 0 || allowed.includes(id)) return true;
  // Portfolio managers can still view other schemes in their agency (read-only later); trustees cannot.
  if (session.role() !== 'trustee') return true;
  return inject(Router).parseUrl(session.homeRoute());
};
