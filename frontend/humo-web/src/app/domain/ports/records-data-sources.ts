import { Observable } from 'rxjs';
import { ComplianceAction, ComplianceDetail, ComplianceItem, ComplianceProfile, NewManualCompliance } from '../models/compliance';
import { DocumentAction, LibraryDocument, NewDocument, RecordKind } from '../models/library';

/**
 * The document library:
 *   GET   /documents?schemeIds=…                 every document in scope (archived included; the client filters)
 *   GET   /documents?record={kind}:{id}          one record's attachments
 *   GET   /documents/{id}
 *   POST  /documents                             upload on a record (multipart: file + metadata)
 *   POST  /documents/{id}/actions                edit details, archive, restore
 *   GET   /documents/{id}/content                the file itself
 *
 * The API decides which schemes a document belongs to from the record it's
 * uploaded on, and filters by visibility for trustees and residents.
 */
export abstract class LibraryDataSource {
  abstract list(schemeIds: string[]): Observable<LibraryDocument[]>;
  abstract forRecord(kind: RecordKind, id: string): Observable<LibraryDocument[]>;
  abstract get(id: string): Observable<LibraryDocument | undefined>;
  /** Returns the new document's id. `file` is the browser file, when one was chosen. */
  abstract upload(input: NewDocument, file?: File): Observable<string>;
  abstract act(id: string, action: DocumentAction, expectedVersion?: number): Observable<void>;
  /** A link to open the file, when the content is available. */
  abstract contentUrl(id: string): string | null;
}

/**
 * Compliance:
 *   GET   /compliance?schemeIds=…                every item, generated from the source records, plus manual items
 *   GET   /compliance/{id}
 *   POST  /compliance/{id}/actions               record a submission or sign-off, complete a manual item
 *   POST  /compliance/items                      add a manual item
 *   GET   /compliance/profiles?schemeIds=…       financial year-end and lifts per scheme
 */
export abstract class ComplianceDataSource {
  abstract list(schemeIds: string[]): Observable<ComplianceItem[]>;
  abstract get(id: string): Observable<ComplianceDetail | undefined>;
  abstract profiles(schemeIds: string[]): Observable<ComplianceProfile[]>;
  abstract act(id: string, action: ComplianceAction, expectedVersion?: number): Observable<void>;
  abstract addManual(input: NewManualCompliance): Observable<string>;
}
