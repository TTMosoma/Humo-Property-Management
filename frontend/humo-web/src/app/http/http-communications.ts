import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import { ApiError, CommunicationsDataSource, ComposePreview, MessageTemplate, SentView } from '../domain';
import { HttpPort } from './http-port';

const notYet = (what: string) => throwError(() => new ApiError('server', `${what} isn’t connected to Humo’s API yet`));

/**
 * Communications over HTTP (docs/18 R-5). Sent is on the API: statements, collection letters and
 * reminders as they were sent, with each delivery's result from the mail server or the SMS network
 * (delivery reports), and retrying failed deliveries. Templates and Compose come with their own slice.
 */
@Injectable()
export class HttpCommunicationsDataSource extends HttpPort implements CommunicationsDataSource {
  sent(schemeIds: string[]): Observable<SentView[]> {
    return this.live<SentView[]>('/communications/sent', ['communications', 'collections', 'billing', 'accounts'], { schemeIds });
  }

  message(id: string): Observable<SentView | undefined> {
    return this.live<SentView>(`/communications/sent/${id}`, ['communications', 'collections', 'billing', 'accounts']).pipe(
      catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))),
    );
  }

  retry(id: string): Observable<void> {
    return this.command('POST', `/communications/sent/${id}/retry`, {}, ['communications']);
  }

  cancel(id: string): Observable<void> {
    return this.command('POST', `/communications/sent/${id}/cancel`, {}, ['communications']);
  }

  templates(): Observable<MessageTemplate[]> {
    return notYet('Message templates');
  }

  saveTemplate(): Observable<string> {
    return notYet('Message templates');
  }

  archiveTemplate(): Observable<void> {
    return notYet('Message templates');
  }

  preview(): Observable<ComposePreview> {
    return notYet('Compose');
  }

  send(): Observable<string> {
    return notYet('Compose');
  }
}
