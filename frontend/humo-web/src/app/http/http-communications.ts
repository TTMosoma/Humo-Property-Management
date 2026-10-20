import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { Audience, Channel, CommunicationsDataSource, ComposeInput, ComposePreview, MessageTemplate, NewNotice, NoticeDataSource, NoticeView, SentView, TemplateInput } from '../domain';
import { HttpPort, toApiErrorFromHttp } from './http-port';

/**
 * Communications over HTTP (docs/18 R-5). Sent is on the API: statements, collection letters and
 * reminders as they were sent, with each delivery's result from the mail server or the SMS network
 * (delivery reports), and retrying failed deliveries; Compose (now or scheduled) with a preview of who
 * an audience reaches, and the agency's message templates.
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
    return this.live<MessageTemplate[]>('/communications/templates', ['communications', 'session']);
  }

  saveTemplate(input: TemplateInput, id?: string, expectedVersion?: number): Observable<string> {
    return id
      ? this.command<{ id: string }>('PUT', `/communications/templates/${id}`, { ...input, expectedVersion }, ['communications']).pipe(map((r) => r.id))
      : this.createId('/communications/templates', input, ['communications']);
  }

  archiveTemplate(id: string): Observable<void> {
    return this.command('POST', `/communications/templates/${id}/archive`, {}, ['communications']);
  }

  /** Who the audience reaches, by which channel, and who can't be reached. Changes nothing. */
  preview(audience: Audience, channels: Channel[]): Observable<ComposePreview> {
    return this.http
      .post<ComposePreview>(`${this.base}/communications/preview`, { audience, channels }, { withCredentials: true })
      .pipe(catchError((e) => throwError(() => toApiErrorFromHttp(e))));
  }

  /** Sends now (in the background) or schedules it. Returns the Sent record's id. */
  send(input: ComposeInput): Observable<string> {
    return this.createId('/communications/messages', input, ['communications']);
  }
}

/** Notices over HTTP: published to a scheme, sent by the agency's rule for new notices, and shown in the resident portal. */
@Injectable()
export class HttpNoticeDataSource extends HttpPort implements NoticeDataSource {
  list(schemeIds: string[]): Observable<NoticeView[]> {
    return this.live<NoticeView[]>('/notices', ['notices', 'schemes'], { schemeIds });
  }

  mine(): Observable<NoticeView[]> {
    return this.live<NoticeView[]>('/me/notices', ['notices', 'session']);
  }

  publish(input: NewNotice): Observable<string> {
    return this.createId('/notices', input, ['notices', 'communications']);
  }

  act(id: string, action: { type: 'pin' | 'unpin' } | { type: 'withdraw'; reason: string }, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/notices/${id}/actions`, { action, expectedVersion }, ['notices']);
  }
}
