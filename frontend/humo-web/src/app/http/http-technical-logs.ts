import { Injectable } from '@angular/core';
import { Observable, catchError, from, map, switchMap, throwError } from 'rxjs';
import { TechnicalLogDataSource, TechnicalLogQuery, TechnicalLogResult } from '../domain';
import { problemFromBlob } from './http-audit-security';
import { HttpPort, toApiErrorFromHttp } from './http-port';

/** Humo's technical logs over HTTP. Commands, not reads, so that reading them is in the audit log. */
@Injectable()
export class HttpTechnicalLogDataSource extends HttpPort implements TechnicalLogDataSource {
  query(q: TechnicalLogQuery): Observable<TechnicalLogResult> {
    return this.command<TechnicalLogResult>('POST', '/platform/logs/query', q, ['audit']);
  }

  /** Needs step-up. Downloads the day's file in the browser and returns its name. */
  download(date: string): Observable<string> {
    return this.http.post(`${this.base}/platform/logs/download`, { date }, { withCredentials: true, observe: 'response', responseType: 'blob' }).pipe(
      map((res) => {
        const name = `humo-log-${date}.json`;
        const url = URL.createObjectURL(res.body!);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return name;
      }),
      catchError((e: unknown) => from(problemFromBlob(e)).pipe(switchMap((err) => throwError(() => toApiErrorFromHttp(err))))),
    );
  }
}
