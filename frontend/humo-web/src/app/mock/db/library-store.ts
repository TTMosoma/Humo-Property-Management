import { Injectable, inject } from '@angular/core';
import {
  DocumentAction,
  FieldErrors,
  LibraryDocument,
  NewDocument,
  RecordKind,
  RecordLink,
  SupplierDocType,
} from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';
import { GovernanceStore } from './governance-store';
import { MaintenanceStore } from './maintenance-store';
import { MockDb } from './mock-db';
import { seedLibrary } from './seed-library';

/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface LibrarySnapshot {
  documents: LibraryDocument[];
  seq: number;
}

/** 25 MB, as the API will enforce. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * The document library "backend" for the prototype. Documents are uploaded on
 * a record; the store works out the record's label, link and schemes, as the
 * API will. A supplier vetting document also updates the supplier's vetting
 * record, so Suppliers and Compliance see the new expiry.
 *
 * File CONTENT isn't kept: a file chosen in this session can be opened until
 * the page reloads (an object URL); seeded documents are metadata only.
 */
@Injectable({ providedIn: 'root' })
export class LibraryStore {
  private readonly db = inject(MockDb);
  private readonly maintenance = inject(MaintenanceStore);
  private readonly governance = inject(GovernanceStore);

  documents: LibraryDocument[];
  private seq: number;
  /** This session's uploaded files, by document id. */
  private readonly files = new Map<string, string>();

  constructor() {
    const saved = simulationStorage.load<LibrarySnapshot>('library');
    if (saved) {
      this.documents = saved.documents;
      this.seq = saved.seq;
    } else {
      this.seq = 100;
      this.documents = seedLibrary(this.db, this.maintenance.suppliers, this.maintenance.jobs, (kind, id) => this.resolve(kind, id));
      this.commit();
    }
  }

  // =================================================================== Reads

  inScope(schemeIds: string[]): LibraryDocument[] {
    const ids = new Set(schemeIds);
    return this.documents.filter((d) => d.schemeIds.some((s) => ids.has(s)));
  }

  forRecord(kind: RecordKind, id: string): LibraryDocument[] {
    return this.documents.filter((d) => d.links.some((l) => l.kind === kind && l.id === id));
  }

  get(id: string): LibraryDocument | undefined {
    return this.documents.find((d) => d.id === id);
  }

  contentUrl(id: string): string | null {
    return this.files.get(id) ?? null;
  }

  /** A record as a link, and the schemes it belongs to. */
  resolve(kind: RecordKind, id: string): { link: RecordLink; schemeIds: string[] } | undefined {
    switch (kind) {
      case 'scheme': {
        const s = this.db.schemes.get(id);
        return s && { link: { kind, id, label: s.name, route: `/schemes/${s.id}/overview` }, schemeIds: [s.id] };
      }
      case 'unit': {
        const u = this.db.unitById.get(id);
        const s = u && this.db.schemes.get(u.schemeId);
        return u && s && { link: { kind, id, label: `Unit ${u.number}, ${s.name}`, route: `/schemes/${s.id}/units/${u.number}` }, schemeIds: [s.id] };
      }
      case 'person': {
        const p = this.db.persons.get(id);
        return p && { link: { kind, id, label: p.displayName, route: `/people/${p.id}` }, schemeIds: this.db.schemesOfPerson(p.id) };
      }
      case 'supplier': {
        const s = this.maintenance.supplier(id);
        return s && { link: { kind, id, label: s.name, route: `/suppliers/${s.id}` }, schemeIds: s.schemeIds };
      }
      case 'job': {
        const j = this.maintenance.jobs.find((x) => x.ref === id || x.id === id);
        return j && { link: { kind, id: j.ref, label: `${j.ref} · ${j.title}`, route: `/maintenance/${j.ref}` }, schemeIds: [j.schemeId] };
      }
      case 'meeting': {
        const m = this.governance.meetings.find((x) => x.id === id);
        return m && { link: { kind, id, label: `${m.ref} · ${m.title}`, route: `/governance/meetings/${m.id}` }, schemeIds: [m.schemeId] };
      }
    }
  }

  // =================================================================== Commands

  checkUpload(input: NewDocument): FieldErrors | null {
    const e: FieldErrors = {};
    if (!this.resolve(input.record.kind, input.record.id)) e['record'] = 'The record this belongs to no longer exists.';
    if (!input.fileName) e['file'] = 'Choose a file.';
    else if (input.sizeBytes > MAX_BYTES) e['file'] = 'Files can be up to 25 MB.';
    if (!input.title.trim()) e['title'] = 'Give it a title people will recognise.';
    if ((input.compliance || (input.category === 'vetting' && input.supplierDoc !== 'Bank confirmation letter')) && !input.expiresAt) e['expiresAt'] = 'Compliance tracks this document: give its expiry date.';
    if (input.compliance && input.record.kind !== 'scheme') e['compliance'] = 'Compliance documents are uploaded on the scheme.';
    if (input.category === 'vetting' && !input.supplierDoc) e['supplierDoc'] = 'Which vetting document is it?';
    if (input.category === 'vetting' && input.record.kind !== 'supplier') e['category'] = 'Vetting documents are uploaded on the supplier.';
    if (input.visibility === 'unit' && input.record.kind !== 'unit') e['visibility'] = '“This unit only” is for documents uploaded on a unit.';
    return Object.keys(e).length ? e : null;
  }

  upload(input: NewDocument, by: string, file?: File): string {
    const r = this.resolve(input.record.kind, input.record.id)!;
    const id = `doc-${++this.seq}`;
    const doc: LibraryDocument = {
      id,
      version: 1,
      title: input.title.trim(),
      fileName: input.fileName,
      mimeType: input.mimeType || 'application/octet-stream',
      sizeBytes: input.sizeBytes,
      category: input.category,
      schemeIds: r.schemeIds,
      links: [r.link],
      visibility: input.visibility,
      uploadedAt: new Date().toISOString(),
      uploadedBy: by,
      expiresAt: input.expiresAt ? endOfDay(input.expiresAt) : undefined,
      compliance: input.compliance,
      supplierDoc: input.supplierDoc,
      notes: input.notes?.trim() || undefined,
    };
    if (file) this.files.set(id, URL.createObjectURL(file));
    // A newer document of the same kind on the same record supersedes the old one.
    for (const old of this.documents.filter((d) => !d.archived && sameSlot(d, doc))) {
      old.archived = { at: doc.uploadedAt, by, reason: `Replaced by “${doc.title}”` };
      old.version++;
    }
    this.documents = [doc, ...this.documents];
    if (input.supplierDoc && input.record.kind === 'supplier') this.updateVetting(input.record.id, input.supplierDoc, doc.expiresAt);
    this.commit();
    return id;
  }

  check(id: string, action: DocumentAction): FieldErrors | null {
    const d = this.get(id);
    if (!d) return { id: 'This document no longer exists.' };
    const e: FieldErrors = {};
    switch (action.type) {
      case 'edit':
        if (!action.title.trim()) e['title'] = 'Give it a title.';
        if ((d.compliance || (d.supplierDoc && d.supplierDoc !== 'Bank confirmation letter')) && !action.expiresAt) e['expiresAt'] = 'Compliance tracks this document: it needs an expiry date.';
        if (action.visibility === 'unit' && d.links[0]?.kind !== 'unit') e['visibility'] = '“This unit only” is for documents uploaded on a unit.';
        break;
      case 'archive':
        if (d.archived) e['id'] = 'Already archived.';
        if (action.reason.trim().length < 3) e['reason'] = 'Say why, for the audit log.';
        break;
      case 'restore':
        if (!d.archived) e['id'] = 'It isn’t archived.';
        break;
    }
    return Object.keys(e).length ? e : null;
  }

  act(id: string, action: DocumentAction, by: string): void {
    const d = this.get(id)!;
    switch (action.type) {
      case 'edit':
        d.title = action.title.trim();
        d.category = action.category;
        d.visibility = action.visibility;
        d.expiresAt = action.expiresAt ? endOfDay(action.expiresAt) : undefined;
        d.notes = action.notes?.trim() || undefined;
        if (d.supplierDoc && d.links[0]?.kind === 'supplier' && !d.archived) this.updateVetting(d.links[0].id, d.supplierDoc, d.expiresAt);
        break;
      case 'archive':
        d.archived = { at: new Date().toISOString(), by, reason: action.reason.trim() };
        break;
      case 'restore':
        d.archived = undefined;
        break;
    }
    d.version++;
    this.commit();
  }

  private updateVetting(supplierId: string, type: SupplierDocType, expiresAt?: string): void {
    this.maintenance.changeSupplier(supplierId, (s) => ({
      ...s,
      documents: [...s.documents.filter((x) => x.type !== type), { type, onFile: true, expires: expiresAt }],
    }));
  }

  private commit(): void {
    simulationStorage.save('library', (): LibrarySnapshot => ({ documents: this.documents, seq: this.seq }));
    this.db.touch();
  }
}

/** Same record, same compliance obligation or vetting document: the new one replaces the old. */
function sameSlot(a: LibraryDocument, b: LibraryDocument): boolean {
  if (a.links[0]?.kind !== b.links[0]?.kind || a.links[0]?.id !== b.links[0]?.id) return false;
  return (!!b.compliance && a.compliance === b.compliance) || (!!b.supplierDoc && a.supplierDoc === b.supplierDoc);
}

/** A date field ("2026-11-30") → the end of that day, local time. */
function endOfDay(date: string): string {
  const d = new Date(date.length <= 10 ? `${date}T23:59:00` : date);
  return d.toISOString();
}
