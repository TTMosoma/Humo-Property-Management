import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import {
  ComplianceAction,
  ComplianceDataSource,
  ComplianceDetail,
  ComplianceItem,
  ComplianceProfile,
  DocumentAction,
  LibraryDataSource,
  LibraryDocument,
  NewDocument,
  NewManualCompliance,
  RecordKind,
} from '../../domain';
import { ComplianceStore } from '../db/compliance-store';
import { LibraryStore } from '../db/library-store';
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
  private readonly respond = mockResponder();

  list(schemeIds: string[]): Observable<LibraryDocument[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.inScope(schemeIds))));
  }

  forRecord(kind: RecordKind, id: string): Observable<LibraryDocument[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.forRecord(kind, id))));
  }

  get(id: string): Observable<LibraryDocument | undefined> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.get(id))));
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
        validate: () => this.store.checkUpload(input),
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
