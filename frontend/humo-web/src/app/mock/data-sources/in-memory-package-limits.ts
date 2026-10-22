import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { PackageLimits, PackageLimitsDataSource } from '../../domain';

/** The prototype has no package limits to warn about. */
@Injectable()
export class InMemoryPackageLimitsDataSource extends PackageLimitsDataSource {
  usage(): Observable<PackageLimits | undefined> {
    return of(undefined);
  }

  startProfessionalTrial(): Observable<void> {
    return of(undefined);
  }
}
