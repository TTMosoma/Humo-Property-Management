import { Observable, of } from 'rxjs';
import { ComplianceAction, ComplianceDetail, ComplianceItem, ComplianceProfile, NewManualCompliance } from '../models/compliance';
import { DocumentAction, LibraryDocument, NewDocument, RecordKind } from '../models/library';
import { NewNotice, NoticeView } from '../models/notice';
import { Audience, ComposeInput, ComposePreview, MessageTemplate, SentView, TemplateInput } from '../models/messaging';
import { Channel } from '../models/settings';
import { ConversationAction, ConversationView, ResidentMessage } from '../models/inbox';
import { NewCover, StaffDetail, StaffSummary } from '../models/staff';
import { BudgetAction, BudgetView, NewBudget } from '../models/budget';

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
  /** Residents: the documents shared with them (their scheme's owners, or their unit). */
  abstract mine(): Observable<LibraryDocument[]>;
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

/**
 * Notices:
 *   GET   /notices?schemeIds=…              staff and trustees: every notice in scope
 *   GET   /me/notices                       residents: notices for their scheme and audience
 *   POST  /notices                          publish (sent by the agency's notification rules)
 *   POST  /notices/{id}/actions             pin, unpin, withdraw
 */
export abstract class NoticeDataSource {
  abstract list(schemeIds: string[]): Observable<NoticeView[]>;
  abstract mine(): Observable<NoticeView[]>;
  abstract publish(input: NewNotice): Observable<string>;
  abstract act(id: string, action: { type: 'pin' | 'unpin' } | { type: 'withdraw'; reason: string }, expectedVersion?: number): Observable<void>;
  /** A resident has seen it in the portal: their portal delivery shows as read in Sent. Nothing to record in the simulation. */
  markRead(_id: string): Observable<void> {
    return of(undefined);
  }
}

/**
 * Communications:
 *   GET   /communications/templates          POST/PUT …/templates/{id}     archive: POST …/{id}/archive
 *   POST  /communications/preview            who an audience reaches, by which channel, and who can't be reached
 *   POST  /communications/messages           send now or schedule
 *   GET   /communications/sent?schemeIds=…   everything sent: messages, notices, letters, statements, replies
 *   GET   /communications/sent/{id}          with each delivery
 *   POST  …/sent/{id}/retry                  failed deliveries again     POST …/sent/{id}/cancel   a scheduled one
 */
export abstract class CommunicationsDataSource {
  abstract templates(): Observable<MessageTemplate[]>;
  abstract saveTemplate(input: TemplateInput, id?: string, expectedVersion?: number): Observable<string>;
  abstract archiveTemplate(id: string): Observable<void>;
  abstract preview(audience: Audience, channels: Channel[]): Observable<ComposePreview>;
  abstract send(input: ComposeInput): Observable<string>;
  abstract sent(schemeIds: string[]): Observable<SentView[]>;
  abstract message(id: string): Observable<SentView | undefined>;
  abstract retry(id: string): Observable<void>;
  abstract cancel(id: string): Observable<void>;
}

/**
 * Inbox:
 *   GET   /inbox?schemeIds=…                 conversations in scope, with the person's unit, balance and open jobs
 *   GET   /inbox/{id}
 *   POST  /inbox/{id}/actions                reply, assign, close, reopen, turn into a job or a Task
 *   GET   /me/conversations                  residents: their own
 *   POST  /me/conversations                  residents: write to the managing agent
 */
export abstract class InboxDataSource {
  abstract list(schemeIds: string[]): Observable<ConversationView[]>;
  abstract get(id: string): Observable<ConversationView | undefined>;
  /** Returns the job ref or Task id for "to-job" / "to-task"; the conversation id otherwise. */
  abstract act(id: string, action: ConversationAction, expectedVersion?: number): Observable<string>;
  abstract mine(): Observable<ConversationView[]>;
  abstract write(message: ResidentMessage): Observable<string>;
}

/**
 * Staff:
 *   GET   /staff                       the organisation's team, with workload from the Attention model
 *   GET   /staff/{staffId}
 *   PUT   /staff/{staffId}/cover       away from–to, covered by a colleague (Users.Manage or Work.Manage)
 *   DELETE /staff/{staffId}/cover      back early
 */
export abstract class StaffDataSource {
  abstract list(): Observable<StaffSummary[]>;
  abstract get(staffId: string): Observable<StaffDetail | undefined>;
  abstract setCover(staffId: string, cover: NewCover): Observable<void>;
  abstract endCover(staffId: string): Observable<void>;
}

/**
 * Budgets:
 *   GET   /budgets?schemeIds=…              each scheme's budgets with actuals from billing and payables
 *   GET   /budgets/{id}
 *   POST  /budgets                          next year's draft, from this year's
 *   POST  /budgets/{id}/actions             set or remove a line, propose at the AGM
 */
export abstract class BudgetDataSource {
  abstract list(schemeIds: string[]): Observable<BudgetView[]>;
  abstract get(id: string): Observable<BudgetView | undefined>;
  abstract create(input: NewBudget): Observable<string>;
  abstract act(id: string, action: BudgetAction, expectedVersion?: number): Observable<void>;
}
