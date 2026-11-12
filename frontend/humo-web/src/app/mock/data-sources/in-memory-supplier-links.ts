import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { ApiError, SupplierLinkDataSource, SupplierLinkView } from '../../domain';

/** The prototype sends no email, so there are no supplier links to open. Nothing is made up. */
@Injectable()
export class InMemorySupplierLinkDataSource implements SupplierLinkDataSource {
  view(): Observable<SupplierLinkView | undefined> {
    return of(undefined);
  }

  photoUrl(): string | undefined {
    return undefined;
  }

  quote(): Observable<void> {
    return this.unavailable();
  }

  decline(): Observable<void> {
    return this.unavailable();
  }

  confirm(): Observable<void> {
    return this.unavailable();
  }

  reschedule(): Observable<void> {
    return this.unavailable();
  }

  private unavailable(): Observable<never> {
    return throwError(() => new ApiError('server', 'Supplier links are only on Humo’s API'));
  }
}
