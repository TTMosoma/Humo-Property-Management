import { Injectable, inject } from '@angular/core';
import { FieldErrors, Identity, NewCover, Role, StaffCover, StaffDetail, StaffSummary, WorkItem, activeAssignments, urgencyOf, todaySA } from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';
import { AccessStore } from './access-store';
import { MockDb } from './mock-db';

/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface StaffSnapshot {
  covers: [string, StaffCover][];
}

const STAFF_ROLES: Role[] = ['agency-admin', 'portfolio-manager', 'finance', 'operations'];
const DAY = 86_400_000;

/**
 * Staff for the prototype: the team from the access directory, workload from
 * the Attention model, and away cover. Other stores ask `routeTo()` before
 * giving someone new work, so a person who's away doesn't collect it.
 */
@Injectable({ providedIn: 'root' })
export class StaffStore {
  private readonly db = inject(MockDb);
  private readonly access = inject(AccessStore);

  private readonly covers = new Map<string, StaffCover>();

  constructor() {
    for (const [k, v] of simulationStorage.load<StaffSnapshot>('staff')?.covers ?? []) this.covers.set(k, v);
  }

  /** Who should get new work meant for this person today: their cover, if they're away. */
  routeTo(staffId: string | null | undefined): string | null {
    if (!staffId) return null;
    const c = this.activeCover(staffId);
    return c ? c.coverId : staffId;
  }

  private activeCover(staffId: string): StaffCover | undefined {
    const c = this.covers.get(staffId);
    if (!c) return undefined;
    const today = todaySA();
    return c.from <= today && today <= c.to ? c : undefined;
  }

  private staffIdentities(organisationId: string): Identity[] {
    return this.access.identities().filter((i) => i.staffId && i.status === 'active' && activeAssignments(i).some((a) => a.scope.organisationId === organisationId && STAFF_ROLES.includes(a.role)));
  }

  summaries(organisationId: string): StaffSummary[] {
    return this.staffIdentities(organisationId).map((i) => this.summary(i, organisationId)).sort((a, b) => a.name.localeCompare(b.name));
  }

  private summary(i: Identity, organisationId: string): StaffSummary {
    const assignments = activeAssignments(i).filter((a) => a.scope.organisationId === organisationId && STAFF_ROLES.includes(a.role));
    const roles = [...new Set(assignments.map((a) => a.role))];
    const allSchemes = assignments.some((a) => a.scope.type === 'organisation');
    const schemeIds = allSchemes ? [...this.db.schemes.values()].filter((s) => s.organisationId === organisationId && s.status !== 'archived').map((s) => s.id) : [...new Set(assignments.flatMap((a) => a.scope.schemeIds))];
    const open = this.db.workItems.filter((w) => w.status === 'open' && w.assigneeId === i.staffId);
    const ids = new Set(schemeIds);
    const covering = [...this.covers.entries()].filter(([id, c]) => c.coverId === i.staffId && this.activeCover(id)).map(([id]) => this.nameOf(id));
    return {
      id: i.staffId!,
      identityId: i.id,
      name: i.name,
      initials: i.initials,
      title: i.title,
      email: i.email,
      roles,
      allSchemes,
      schemes: schemeIds.map((id) => this.db.schemes.get(id)!).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)),
      openTasks: open.filter((w) => w.kind === 'task').length,
      overdueTasks: open.filter((w) => w.kind === 'task' && urgencyOf(w) === 'overdue').length,
      openMessages: open.filter((w) => w.kind === 'message').length,
      approvalsWaiting: this.db.workItems.filter((w) => w.kind === 'approval' && w.status === 'open' && ids.has(w.schemeId) && (w.approverRoles ?? []).some((r) => roles.includes(r))).length,
      away: this.activeCover(i.staffId!) ?? (this.covers.get(i.staffId!) && this.covers.get(i.staffId!)!.to >= todaySA() ? this.covers.get(i.staffId!) : undefined),
      covering,
    };
  }

  detail(staffId: string, organisationId: string): StaffDetail | undefined {
    const i = this.staffIdentities(organisationId).find((x) => x.staffId === staffId);
    if (!i) return undefined;
    const since = new Date(Date.now() - 14 * DAY).toISOString();
    return {
      ...this.summary(i, organisationId),
      openWork: this.db.workItems.filter((w) => w.status === 'open' && w.assigneeId === staffId).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      doneRecently: this.db.workItems.filter((w) => w.status !== 'open' && (w.decidedBy === i.name || (w.assigneeId === staffId && w.status === 'done')) && (w.decidedAt ?? '') >= since).sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')).slice(0, 15),
    };
  }

  nameOf(staffId: string): string {
    return this.access.identities().find((i) => i.staffId === staffId)?.name ?? staffId;
  }

  // =================================================================== Cover

  checkCover(staffId: string, c: NewCover, organisationId: string): FieldErrors | null {
    const e: FieldErrors = {};
    const team = this.staffIdentities(organisationId);
    if (!team.some((i) => i.staffId === staffId)) e['staffId'] = 'Not on the team.';
    if (c.coverId === staffId) e['coverId'] = 'Choose someone else to cover.';
    else if (!team.some((i) => i.staffId === c.coverId)) e['coverId'] = 'Choose a colleague.';
    else if (this.activeCover(c.coverId)) e['coverId'] = `${this.nameOf(c.coverId)} is away too.`;
    if (!c.from || !c.to || c.to < c.from) e['to'] = 'The last day can’t be before the first.';
    if (c.to < todaySA()) e['to'] = 'That’s already over.';
    if (c.reason.trim().length < 3) e['reason'] = 'E.g. leave, training, sick.';
    return Object.keys(e).length ? e : null;
  }

  setCover(staffId: string, c: NewCover, by: string): void {
    this.endCover(staffId, by, false);
    const cover: StaffCover = { coverId: c.coverId, coverName: this.nameOf(c.coverId), from: c.from, to: c.to, reason: c.reason.trim(), setBy: by, movedIds: [] };
    this.covers.set(staffId, cover);
    if (this.activeCover(staffId)) this.moveOpenWork(staffId, cover);
    this.commit();
  }

  /** Back (early or on time): whatever's still open with the cover moves back. */
  endCover(staffId: string, by: string, commit = true): void {
    const c = this.covers.get(staffId);
    if (!c) return;
    const back = this.db.workItems.filter((w) => c.movedIds.includes(w.id) && w.status === 'open' && w.assigneeId === c.coverId).map((w) => w.id);
    if (back.length) this.db.updateWork(back, (w) => ({ ...w, assigneeId: staffId }));
    this.covers.delete(staffId);
    if (commit) this.commit();
    void by;
  }

  private moveOpenWork(staffId: string, c: StaffCover): void {
    const ids = this.db.workItems.filter((w: WorkItem) => w.status === 'open' && w.assigneeId === staffId && w.kind !== 'approval').map((w) => w.id);
    c.movedIds = ids;
    if (ids.length) this.db.updateWork(ids, (w) => ({ ...w, assigneeId: c.coverId }));
  }

  private commit(): void {
    simulationStorage.save('staff', (): StaffSnapshot => ({ covers: [...this.covers.entries()] }));
    this.db.touch();
  }
}
