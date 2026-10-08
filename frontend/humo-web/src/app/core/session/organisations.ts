import { Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { Organisation, OrganisationDataSource } from '../../domain';

/**
 * The organisations the signed-in person can see (every one for Humo staff),
 * for labels and pickers. A failed load just means names fall back to ids.
 * Call in an injection context.
 */
export function visibleOrganisations(): Signal<Organisation[]> {
  return toSignal(inject(OrganisationDataSource).list().pipe(catchError(() => of([] as Organisation[]))), { initialValue: [] });
}

/** "Acacia Managing Agents", or the id when the name isn't known. */
export function organisationName(all: Organisation[], id: string | null | undefined, none = 'Humo'): string {
  if (!id) return none;
  return all.find((o) => o.id === id)?.shortName ?? id;
}
