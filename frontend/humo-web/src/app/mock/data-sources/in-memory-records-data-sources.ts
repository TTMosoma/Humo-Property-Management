import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import {
  BoardAction,
  BoardCandidate,
  BoardDataSource,
  BoardSummary,
  BoardView,
  BreachAction,
  BreachView,
  NewBreach,
  RuleAction,
  RulesDataSource,
  RulesView,
  BudgetAction,
  BudgetDataSource,
  BudgetView,
  NewBudget,
  NewCover,
  StaffDataSource,
  StaffDetail,
  StaffSummary,
  ConversationAction,
  ConversationView,
  InboxDataSource,
  ResidentMessage,
  Audience,
  Channel,
  CommunicationsDataSource,
  ComposeInput,
  ComposePreview,
  MessageTemplate,
  SentView,
  TemplateInput,
  ComplianceAction,
  ComplianceDataSource,
  ComplianceDetail,
  ComplianceItem,
  ComplianceProfile,
  DocumentAction,
  FieldErrors,
  LibraryDataSource,
  LibraryDocument,
  NewDocument,
  NewManualCompliance,
  NewNotice,
  NoticeDataSource,
  NoticeView,
  RecordKind,
} from '../../domain';
import { ComplianceStore } from '../db/compliance-store';
import { LibraryStore } from '../db/library-store';
import { StorageMeter } from '../db/storage-meter';
import { NoticeStore } from '../db/notice-store';
import { CommsStore } from '../db/comms-store';
import { InboxStore } from '../db/inbox-store';
import { StaffStore } from '../db/staff-store';
import { BudgetStore } from '../db/budget-store';
import { BoardStore } from '../db/board-store';
import { RulesStore } from '../db/rules-store';
import { MockDb } from '../db/mock-db';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

const DOC_VERB: Record<DocumentAction['type'], string> = {
  edit: 'Edited document',
  archive: 'Archived document',
  restore: 'Restored document',
};

@Injectable()
export class InMemoryLibraryDataSource extends LibraryDataSource {
  private readonly store = inject(LibraryStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly storage = inject(StorageMeter);
  private readonly respond = mockResponder();

  /** The API filters by visibility: trustees see what's shared with trustees and owners; staff see everything. */
  private visible(docs: LibraryDocument[]): LibraryDocument[] {
    const role = this.auth.assignment()?.role;
    if (role === 'trustee') return docs.filter((d) => d.visibility === 'trustees' || d.visibility === 'owners');
    if (role === 'owner' || role === 'tenant') return [];
    return docs;
  }

  list(schemeIds: string[]): Observable<LibraryDocument[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.visible(this.store.inScope(schemeIds)))));
  }

  forRecord(kind: RecordKind, id: string): Observable<LibraryDocument[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.visible(this.store.forRecord(kind, id)))));
  }

  /** Owners: their scheme's owner documents and their unit's; tenants: their unit's only. Archived ones aren't shown. */
  mine(): Observable<LibraryDocument[]> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const a = this.auth.assignment();
        const schemeId = a?.scope.schemeIds[0];
        const unitId = a?.scope.unitId;
        const docs = this.store.documents.filter(
          (d) =>
            !d.archived &&
            ((a?.role === 'owner' && d.visibility === 'owners' && !!schemeId && d.schemeIds.includes(schemeId)) ||
              (d.visibility === 'unit' && !!unitId && d.links.some((l) => l.kind === 'unit' && l.id === unitId))),
        );
        return this.respond(docs.sort((x, y) => y.uploadedAt.localeCompare(x.uploadedAt)));
      }),
    );
  }

  get(id: string): Observable<LibraryDocument | undefined> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const d = this.visible([this.store.get(id)].filter((x): x is LibraryDocument => !!x))[0];
        // A copy, as the API would send: the store changes documents in place, and an unchanged
        // reference wouldn't refresh the page after archive, restore or edit.
        return this.respond(d ? { ...d } : undefined);
      }),
    );
  }

  upload(input: NewDocument, file?: File): Observable<string> {
    const r = this.store.resolve(input.record.kind, input.record.id);
    return this.gateway.command(
      {
        action: `Uploaded “${input.title.trim()}” to ${r?.link.label ?? 'a record'}`,
        resource: 'Document',
        schemeId: r?.schemeIds.length === 1 ? r.schemeIds[0] : undefined,
        permission: 'Documents.Manage',
        feature: 'documents',
        // The simulated API refuses an upload over the organisation's storage quota (docs/23 §5).
        validate: () => this.store.checkUpload(input) ?? this.storage.checkUpload(this.auth.current.organisation?.id, input.sizeBytes),
      },
      () => this.store.upload(input, this.auth.current.identity.name, file),
    );
  }

  act(id: string, action: DocumentAction, expectedVersion?: number): Observable<void> {
    const d = this.store.get(id);
    return this.gateway
      .command(
        {
          action: `${DOC_VERB[action.type]} “${d?.title ?? id}”`,
          resource: 'Document',
          resourceId: id,
          schemeId: d?.schemeIds.length === 1 ? d.schemeIds[0] : undefined,
          permission: 'Documents.Manage',
          feature: 'documents',
          version: { expected: expectedVersion, current: d?.version },
          validate: () => this.store.check(id, action),
        },
        () => this.store.act(id, action, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }

  contentUrl(id: string): string | null {
    return this.store.contentUrl(id);
  }
}

@Injectable()
export class InMemoryComplianceDataSource extends ComplianceDataSource {
  private readonly store = inject(ComplianceStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  list(schemeIds: string[]): Observable<ComplianceItem[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.items(schemeIds))));
  }

  get(id: string): Observable<ComplianceDetail | undefined> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.detail(id))));
  }

  profiles(schemeIds: string[]): Observable<ComplianceProfile[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(schemeIds.map((id) => this.store.profile(id)))));
  }

  act(id: string, action: ComplianceAction, expectedVersion?: number): Observable<void> {
    const item = this.store.item(id);
    return this.gateway
      .command(
        {
          action: action.type === 'record' ? `Recorded ${item?.title ?? id} as done (${action.reference.trim()})` : `Completed compliance item “${item?.title ?? id}”`,
          resource: 'Compliance',
          resourceId: item?.ref,
          schemeId: item?.schemeId,
          permission: 'Compliance.Manage',
          feature: 'compliance',
          version: { expected: expectedVersion, current: item?.version },
          validate: () => this.store.check(id, action),
        },
        () => this.store.act(id, action, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }

  addManual(input: NewManualCompliance): Observable<string> {
    return this.gateway.command(
      {
        action: `Added compliance item “${input.title.trim()}”`,
        resource: 'Compliance',
        schemeId: input.schemeId,
        permission: 'Compliance.Manage',
        feature: 'compliance',
        validate: () => this.store.checkManual(input),
      },
      () => this.store.addManual(input, this.auth.current.identity.name),
    );
  }
}

@Injectable()
export class InMemoryNoticeDataSource extends NoticeDataSource {
  private readonly store = inject(NoticeStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  /** Staff see every notice; trustees see the ones for residents, owners and trustees of their scheme (the API filters by scope). */
  list(schemeIds: string[]): Observable<NoticeView[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.inScope(schemeIds))));
  }

  mine(): Observable<NoticeView[]> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const a = this.auth.assignment();
        const schemeId = a?.scope.schemeIds[0];
        return this.respond(schemeId && (a.role === 'owner' || a.role === 'tenant') ? this.store.forResident(schemeId, a.role) : []);
      }),
    );
  }

  publish(input: NewNotice): Observable<string> {
    return this.gateway.command(
      {
        action: `Published notice “${input.title.trim()}”`,
        resource: 'Notice',
        schemeId: input.schemeId,
        permission: 'Messages.Reply',
        feature: 'communications',
        validate: () => this.store.check(input),
      },
      () => this.store.publish(input, this.auth.current.identity.name),
    );
  }

  act(id: string, action: { type: 'pin' | 'unpin' } | { type: 'withdraw'; reason: string }, expectedVersion?: number): Observable<void> {
    const n = this.store.notices.find((x) => x.id === id);
    return this.gateway
      .command(
        {
          action: `${action.type === 'withdraw' ? 'Withdrew' : action.type === 'pin' ? 'Pinned' : 'Unpinned'} notice “${n?.title ?? id}”`,
          resource: 'Notice',
          resourceId: n?.ref,
          schemeId: n?.schemeId,
          permission: 'Messages.Reply',
          feature: 'communications',
          version: { expected: expectedVersion, current: n?.version },
          validate: (): FieldErrors | null => {
            if (!n) return { id: 'No such notice.' };
            if (action.type === 'withdraw' && n.withdrawn) return { id: 'Already withdrawn.' };
            if (action.type === 'withdraw' && action.reason.trim().length < 3) return { reason: 'Say why, for the audit log.' };
            return null;
          },
        },
        () => this.store.act(id, action, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }
}

@Injectable()
export class InMemoryCommunicationsDataSource extends CommunicationsDataSource {
  private readonly store = inject(CommsStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  templates(): Observable<MessageTemplate[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.templates.filter((t) => !t.archived))));
  }

  saveTemplate(input: TemplateInput, id?: string, expectedVersion?: number): Observable<string> {
    const t = id ? this.store.templates.find((x) => x.id === id) : undefined;
    return this.gateway.command(
      {
        action: `${id ? 'Edited' : 'Created'} message template “${input.name.trim()}”`,
        resource: 'MessageTemplate',
        resourceId: id,
        permission: 'Messages.Reply',
        feature: 'communications',
        version: id ? { expected: expectedVersion, current: t?.version } : undefined,
        validate: () => this.store.checkTemplate(input, id),
      },
      () => this.store.saveTemplate(input, this.auth.current.identity.name, id),
    );
  }

  archiveTemplate(id: string): Observable<void> {
    const t = this.store.templates.find((x) => x.id === id);
    return this.gateway
      .command(
        {
          action: `Archived message template “${t?.name ?? id}”`,
          resource: 'MessageTemplate',
          resourceId: id,
          permission: 'Messages.Reply',
          feature: 'communications',
          validate: () => (!t ? { id: 'No such template.' } : t.builtIn ? { id: 'Starter templates can be edited but not archived.' } : null),
        },
        () => this.store.archiveTemplate(id),
      )
      .pipe(map(() => undefined));
  }

  preview(audience: Audience, channels: Channel[]): Observable<ComposePreview> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.db.schemes.has(audience.schemeId) ? this.store.preview(audience, channels) : { audienceLabel: '', recipients: [], skipped: [], byChannel: {} })));
  }

  send(input: ComposeInput): Observable<string> {
    return this.gateway.command(
      {
        action: `${input.sendAt ? 'Scheduled' : 'Sent'} “${input.subject.trim() || input.body.trim().slice(0, 40)}” to ${this.db.schemes.has(input.audience.schemeId) ? this.store.audienceLabel(input.audience) : 'an audience'}`,
        resource: 'Message',
        schemeId: input.audience.schemeId,
        permission: 'Messages.Reply',
        feature: 'communications',
        validate: () => this.store.checkSend(input),
      },
      () => this.store.compose(input, this.auth.current.identity.name),
    );
  }

  sent(schemeIds: string[]): Observable<SentView[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.inScope(schemeIds))));
  }

  message(id: string): Observable<SentView | undefined> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.get(id))));
  }

  retry(id: string): Observable<void> {
    const m = this.store.get(id);
    return this.gateway
      .command(
        {
          action: `Retried failed deliveries of ${m?.message.ref ?? id}`,
          resource: 'Message',
          resourceId: m?.message.ref,
          schemeId: m?.message.schemeId,
          permission: 'Messages.Reply',
          feature: 'communications',
          validate: () => (!m ? { id: 'No such message.' } : m.counts.failed + m.counts.bounced === 0 ? { id: 'Nothing failed.' } : null),
        },
        () => this.store.retry(m!.message.id),
      )
      .pipe(map(() => undefined));
  }

  cancel(id: string): Observable<void> {
    const m = this.store.get(id);
    return this.gateway
      .command(
        {
          action: `Cancelled scheduled message ${m?.message.ref ?? id}`,
          resource: 'Message',
          resourceId: m?.message.ref,
          schemeId: m?.message.schemeId,
          permission: 'Messages.Reply',
          feature: 'communications',
          validate: () => (!m ? { id: 'No such message.' } : m.state !== 'scheduled' ? { id: 'Only a scheduled message can be cancelled.' } : null),
        },
        () => this.store.cancel(m!.message.id, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }
}

const INBOX_VERB: Record<ConversationAction['type'], string> = {
  reply: 'Replied to',
  assign: 'Assigned',
  close: 'Closed',
  reopen: 'Reopened',
  'to-job': 'Turned into a job:',
  'to-task': 'Turned into a Task:',
};

@Injectable()
export class InMemoryInboxDataSource extends InboxDataSource {
  private readonly store = inject(InboxStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  list(schemeIds: string[]): Observable<ConversationView[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.inScope(schemeIds))));
  }

  get(id: string): Observable<ConversationView | undefined> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const c = this.store.get(id);
        return this.respond(c ? this.store.view(c) : undefined);
      }),
    );
  }

  act(id: string, action: ConversationAction, expectedVersion?: number): Observable<string> {
    const c = this.store.get(id);
    return this.gateway.command(
      {
        action: `${INBOX_VERB[action.type]} ${c?.ref ?? id}`,
        resource: 'Conversation',
        resourceId: c?.ref,
        schemeId: c?.schemeId,
        permission: action.type === 'to-job' ? 'Maintenance.Log' : 'Messages.Reply',
        version: { expected: expectedVersion, current: c?.version },
        validate: () => this.store.check(id, action),
      },
      () => this.store.act(c!.id, action, this.auth.current.identity.name, this.auth.current.identity.staffId ?? this.auth.current.identity.id),
    );
  }

  /** Residents see their own conversations (the API filters by the caller's person). */
  mine(): Observable<ConversationView[]> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const personId = this.auth.current.identity.personId;
        return this.respond(personId ? this.store.forPerson(personId) : []);
      }),
    );
  }

  write(message: ResidentMessage): Observable<string> {
    const a = this.auth.assignment();
    const person = this.auth.current.identity.personId ? this.db.persons.get(this.auth.current.identity.personId) : undefined;
    const schemeId = a?.scope.schemeIds[0];
    return this.gateway.command(
      {
        action: message.conversationId ? 'Replied to the managing agent' : `Wrote to the managing agent: “${message.subject.trim()}”`,
        resource: 'Conversation',
        schemeId,
        permission: 'Resident.Portal',
        validate: () => (!person || !schemeId ? { id: 'Your account isn’t linked to a unit yet.' } : this.store.checkResident(message)),
      },
      () => this.store.fromResident(person!, schemeId!, a?.scope.unitId, message),
    );
  }
}

@Injectable()
export class InMemoryStaffDataSource extends StaffDataSource {
  private readonly store = inject(StaffStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  private get org(): string {
    return this.auth.current.organisation?.id ?? '';
  }

  list(): Observable<StaffSummary[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.summaries(this.org))));
  }

  get(staffId: string): Observable<StaffDetail | undefined> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.detail(staffId, this.org))));
  }

  /** Your own cover, or anyone's if you manage users. */
  private mayCover(staffId: string): FieldErrors | null {
    return staffId === this.auth.current.identity.staffId || this.auth.can('Users.Manage') ? null : { staffId: 'Only an agency administrator can set someone else’s cover.' };
  }

  setCover(staffId: string, cover: NewCover): Observable<void> {
    return this.gateway
      .command(
        {
          action: `Set away cover for ${this.store.nameOf(staffId)}: ${this.store.nameOf(cover.coverId)}, ${cover.from} to ${cover.to}`,
          resource: 'Staff',
          resourceId: staffId,
          permission: 'Work.Manage',
          validate: () => this.mayCover(staffId) ?? this.store.checkCover(staffId, cover, this.org),
        },
        () => this.store.setCover(staffId, cover, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }

  endCover(staffId: string): Observable<void> {
    return this.gateway
      .command(
        {
          action: `Ended away cover for ${this.store.nameOf(staffId)}`,
          resource: 'Staff',
          resourceId: staffId,
          permission: 'Work.Manage',
          validate: () => this.mayCover(staffId),
        },
        () => this.store.endCover(staffId, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }
}

@Injectable()
export class InMemoryBudgetDataSource extends BudgetDataSource {
  private readonly store = inject(BudgetStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  list(schemeIds: string[]): Observable<BudgetView[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.inScope(schemeIds))));
  }

  get(id: string): Observable<BudgetView | undefined> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const b = this.store.get(id);
        return this.respond(b ? this.store.view(b) : undefined);
      }),
    );
  }

  create(input: NewBudget): Observable<string> {
    return this.gateway.command(
      {
        action: `Drafted next year’s budget for ${this.db.schemes.get(input.schemeId)?.name ?? input.schemeId} (${input.increasePct >= 0 ? '+' : ''}${input.increasePct}%)`,
        resource: 'Budget',
        schemeId: input.schemeId,
        permission: 'Budgets.Manage',
        feature: 'budgets',
        validate: () => this.store.checkCreate(input),
      },
      () => this.store.create(input, this.auth.current.identity.name),
    );
  }

  act(id: string, action: BudgetAction, expectedVersion?: number): Observable<void> {
    const b = this.store.get(id);
    const what = action.type === 'set-line' ? `Set ${action.category} to R ${action.annual.toLocaleString('en-ZA')}` : action.type === 'remove-line' ? `Removed ${action.category}` : 'Proposed it at the AGM';
    return this.gateway
      .command(
        {
          action: `${what} in the ${b?.year ?? ''} budget for ${b ? this.db.scheme(b.schemeId).name : id}`,
          resource: 'Budget',
          resourceId: id,
          schemeId: b?.schemeId,
          permission: 'Budgets.Manage',
          feature: 'budgets',
          version: { expected: expectedVersion, current: b?.version },
          validate: () => this.store.check(id, action),
        },
        () => this.store.act(id, action, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }
}

@Injectable()
export class InMemoryBoardDataSource extends BoardDataSource {
  private readonly store = inject(BoardStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  list(schemeIds: string[]): Observable<BoardSummary[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.summaries(schemeIds))));
  }

  get(schemeId: string): Observable<BoardView | undefined> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.board(schemeId))));
  }

  candidates(schemeId: string): Observable<BoardCandidate[]> {
    return this.respond(this.store.candidates(schemeId));
  }

  act(schemeId: string, action: BoardAction): Observable<void> {
    const name = (personId: string) => this.db.persons.get(personId)?.displayName ?? personId;
    const rel = 'relationshipId' in action ? this.db.relationship(action.relationshipId) : undefined;
    const what =
      action.type === 'appoint'
        ? `${action.how === 'elected' ? 'Elected' : 'Co-opted'} ${name(action.personId)} as ${action.portfolio}`
        : action.type === 'end'
          ? `Ended ${rel ? name(rel.personId) : ''}’s term as trustee (${action.reason.trim()})`
          : action.type === 'set-portfolio'
            ? `Made ${rel ? name(rel.personId) : ''} ${action.portfolio}`
            : `Set the board’s minimum to ${action.minimum}`;
    return this.gateway
      .command(
        {
          action: `${what} · ${this.db.schemes.get(schemeId)?.name ?? schemeId}`,
          resource: 'Trustee board',
          resourceId: schemeId,
          schemeId,
          permission: 'Meetings.Manage',
          feature: 'governance',
          validate: () => this.store.check(schemeId, action),
        },
        () => this.store.act(schemeId, action, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }
}

@Injectable()
export class InMemoryRulesDataSource extends RulesDataSource {
  private readonly store = inject(RulesStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  rules(schemeId: string): Observable<RulesView | undefined> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.view(schemeId))));
  }

  actRules(schemeId: string, action: RuleAction, file?: File): Observable<string | void> {
    const rule = 'ruleId' in action ? this.store.rules.find((r) => r.id === action.ruleId) : undefined;
    const what =
      action.type === 'add'
        ? `Added rule ${action.number.trim()} (${action.title.trim()})`
        : action.type === 'amend'
          ? `Amended rule ${rule?.number ?? ''}`
          : action.type === 'repeal'
            ? `Repealed rule ${rule?.number ?? ''}`
            : action.type === 'upload'
              ? `Uploaded the registered rules PDF “${action.fileName}” (in force from ${action.adoptedOn}; ${action.resolutionRef.trim()})${action.shareWithOwners ? ' and shared it with owners' : ''}`
              : 'Shared the rule book with owners';
    return this.gateway.command(
      {
        action: `${what} · ${this.db.schemes.get(schemeId)?.name ?? schemeId}`,
        resource: 'Scheme rules',
        resourceId: schemeId,
        schemeId,
        permission: 'Meetings.Manage',
        feature: 'governance',
        validate: () => this.store.checkRules(schemeId, action),
      },
      () => this.store.actRules(schemeId, action, this.auth.current.identity.name, file),
    );
  }

  breaches(schemeIds: string[]): Observable<BreachView[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.inScope(schemeIds))));
  }

  breach(id: string): Observable<BreachView | undefined> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const b = this.store.get(id);
        return this.respond(b ? this.store.breachView(b) : undefined);
      }),
    );
  }

  logBreach(input: NewBreach): Observable<string> {
    const unit = this.db.unitById.get(input.unitId);
    return this.gateway.command(
      {
        action: `Logged a rule breach at Unit ${unit?.number ?? input.unitId}, ${this.db.schemes.get(input.schemeId)?.name ?? input.schemeId}`,
        resource: 'Rule breach',
        schemeId: input.schemeId,
        permission: 'Rules.Enforce',
        feature: 'governance',
        validate: () => this.store.checkLog(input),
      },
      () => this.store.log(input, this.auth.current.identity.name),
    );
  }

  actBreach(id: string, action: BreachAction, expectedVersion?: number): Observable<void> {
    const b = this.store.get(id);
    const what = { warn: 'final' in action && action.final ? 'Sent a final warning' : 'Sent a warning', note: 'Added a note', refer: 'Referred to the trustees', resolve: 'Resolved', reopen: 'Reopened' }[action.type];
    return this.gateway
      .command(
        {
          action: `${what} · breach ${b?.ref ?? id}`,
          resource: 'Rule breach',
          resourceId: id,
          schemeId: b?.schemeId,
          permission: 'Rules.Enforce',
          feature: 'governance',
          version: { expected: expectedVersion, current: b?.version },
          validate: () => this.store.checkBreach(id, action),
        },
        () => this.store.actBreach(id, action, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }
}
