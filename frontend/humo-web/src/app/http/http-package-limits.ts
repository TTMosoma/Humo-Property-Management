import { Injectable } from '@angular/core';
import { Observable, catchError, of } from 'rxjs';
import { PackageLimits, PackageLimitsDataSource } from '../domain';
import { HttpPort } from './http-port';

/**
 * The package limits over HTTP. A person without the subscription permission gets nothing, quietly: the warning
 * is a courtesy, so a refusal here shouldn't raise a notice.
 */
@Injectable()
export class HttpPackageLimitsDataSource extends HttpPort implements PackageLimitsDataSource {
  usage(): Observable<PackageLimits | undefined> {
    return this.http.get<PackageLimits>(`${this.base}/me/limits`, { withCredentials: true }).pipe(catchError(() => of(undefined)));
  }
}
