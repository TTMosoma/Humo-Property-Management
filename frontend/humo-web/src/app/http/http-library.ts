import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { ApiError, DocumentAction, LibraryDataSource, LibraryDocument, NewDocument, RecordKind } from '../domain';
import { HttpPort, toApiErrorFromHttp } from './http-port';

/** The record kinds the API holds documents for. */
const ON_API: RecordKind[] = ['scheme', 'unit', 'job'];

/**
 * The document library over HTTP (docs/18 R-11). Documents on schemes, units and jobs are on the API: upload, list,
 * read, edit, archive and restore, and opening through a link signed for the person who asks. Each person sees what
 * is shared with them (`mine`). Documents on people, suppliers and meetings come in a later slice: until then those
 * lists are empty here, and uploads for those records are refused.
 */
@Injectable()
export class HttpLibraryDataSource extends HttpPort implements LibraryDataSource {
  list(schemeIds: string[]): Observable<LibraryDocument[]> {
    return this.live<LibraryDocument[]>('/documents/library', ['documents'], { schemeIds });
  }

  forRecord(kind: RecordKind, id: string): Observable<LibraryDocument[]> {
    if (!ON_API.includes(kind)) return of([]);
    return this.live<LibraryDocument[]>('/documents/library', ['documents'], { record: `${kind}:${id}` });
  }

  /** What's shared with the signed-in person: their scheme's, unit's and trustee documents. */
  mine(): Observable<LibraryDocument[]> {
    return this.live<LibraryDocument[]>('/documents/library/mine', ['documents']);
  }

  get(id: string): Observable<LibraryDocument | undefined> {
    return this.live<LibraryDocument>(`/documents/library/${id}`, ['documents']).pipe(
      catchError((e: unknown) => (e instanceof ApiError && e.kind === 'not-found' ? of(undefined) : throwError(() => e))),
    );
  }

  upload(input: NewDocument, file?: File): Observable<string> {
    if (!ON_API.includes(input.record.kind)) return throwError(() => new ApiError('server', 'Documents on this record come in a later slice.'));
    if (!file) return throwError(() => new ApiError('validation', 'Choose a PDF to upload.', { file: 'Choose a PDF to upload.' }));
    const form = new FormData();
    // A scheme names itself; a unit or a job is named with its own kind, and the API works out its scheme.
    if (input.record.kind === 'scheme') form.append('schemeId', input.record.id);
    form.append('recordKind', input.record.kind);
    form.append('recordId', input.record.id);
    form.append('title', input.title);
    form.append('category', input.category);
    form.append('visibility', input.visibility);
    if (input.expiresAt) form.append('expiresAt', input.expiresAt);
    if (input.notes) form.append('notes', input.notes);
    form.append('file', file, file.name);
    return this.createId('/documents/library', form, ['documents']);
  }

  act(id: string, action: DocumentAction, expectedVersion = 0): Observable<void> {
    const body =
      action.type === 'edit'
        ? { type: 'edit', expectedVersion, title: action.title, category: action.category, visibility: action.visibility, expiresAt: action.expiresAt ?? '', notes: action.notes ?? '' }
        : action.type === 'archive'
          ? { type: 'archive', expectedVersion, reason: action.reason }
          : { type: 'restore', expectedVersion };
    return this.command('POST', `/documents/library/${id}/actions`, body, ['documents']);
  }

  /** A link to open the file: signed for this person and valid for a few minutes, so it's asked for when it's opened. */
  contentLink(id: string): Observable<string> {
    return this.http.get<{ url: string }>(`${this.base}/documents/library/${id}/link`, { withCredentials: true }).pipe(
      map((r) => r.url),
      catchError((e: unknown) => throwError(() => toApiErrorFromHttp(e))),
    );
  }
}
