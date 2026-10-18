import { Injectable, inject } from '@angular/core';
import { BoardAction, BoardCandidate, BoardSummary, BoardView, DEFAULT_MIN_TRUSTEES, FieldErrors, Relationship, TRUSTEE_PORTFOLIOS, TrusteeView, todaySA } from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';
import { AccessStore } from './access-store';
import { GovernanceStore } from './governance-store';
import { MockDb } from './mock-db';

interface BoardSnapshot {
  minimums: [string, number][];
}

/**
 * DEVELOPMENT / SIMULATION ONLY. Trustee boards: the trustee relationships in
 * MockDb, read and changed as a board. Quorum, approvers and the trustees'
 * audience all read `db.trustees()`, so a change here reaches them at once.
 */
@Injectable({ providedIn: 'root' })
export class BoardStore {
  private readonly db = inject(MockDb);
  private readonly access = inject(AccessStore);
  private readonly governance = inject(GovernanceStore);

  private readonly minimums = new Map<string, number>(simulationStorage.load<BoardSnapshot>('boards')?.minimums ?? []);

  minimum(schemeId: string): number {
    return this.minimums.get(schemeId) ?? DEFAULT_MIN_TRUSTEES;
  }

  // =================================================================== Reads

  private view(r: Relationship): TrusteeView | undefined {
    const person = this.db.persons.get(r.personId);
    if (!person) return undefined;
    const units = this.db
      .relationshipsIn(r.schemeId, 'owner')
      .filter((o) => o.personId === r.personId && o.unitId && this.db.isCurrent(o))
      .map((o) => this.db.unitById.get(o.unitId!)?.accountNo ?? '')
      .filter(Boolean);
    const hasSignIn = this.access.identities().some((i) => i.status === 'active' && i.personId === r.personId);
    const invited = !hasSignIn && this.access.identities().some((i) => i.status === 'invited' && i.personId === r.personId);
    return { relationship: r, person, units, hasSignIn, invited };
  }

  board(schemeId: string): BoardView | undefined {
    const scheme = this.db.schemes.get(schemeId);
    if (!scheme) return undefined;
    const all = this.db.relationshipsIn(schemeId, 'trustee');
    const order = (p?: string) => {
      const i = TRUSTEE_PORTFOLIOS.indexOf((p ?? 'Trustee') as (typeof TRUSTEE_PORTFOLIOS)[number]);
      return i < 0 ? 9 : i;
    };
    const trustees = all
      .filter((r) => this.db.isCurrent(r))
      .sort((a, b) => order(a.portfolio) - order(b.portfolio) || a.since.localeCompare(b.since))
      .map((r) => this.view(r))
      .filter((t): t is TrusteeView => !!t);
    const former = all
      .filter((r) => !this.db.isCurrent(r))
      .sort((a, b) => (b.until ?? '').localeCompare(a.until ?? ''))
      .map((r) => this.view(r))
      .filter((t): t is TrusteeView => !!t);
    const agm = this.governance.meetings
      .filter((m) => m.schemeId === schemeId && m.type === 'agm' && ['draft', 'notice-sent', 'pack-ready'].includes(m.stage))
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0];
    return {
      scheme,
      trustees,
      former,
      minimum: this.minimum(schemeId),
      coOpted: trustees.filter((t) => t.relationship.appointment?.how === 'co-opted').length,
      nextAgm: agm ? { id: agm.id, ref: agm.ref, scheduledFor: agm.scheduledFor } : undefined,
    };
  }

  summaries(schemeIds: string[]): BoardSummary[] {
    return schemeIds
      .map((id) => this.db.schemes.get(id))
      .filter((s) => !!s && s.status !== 'archived' && s.status !== 'prospect')
      .map((s) => {
        const b = this.board(s!.id)!;
        return {
          scheme: s!,
          size: b.trustees.length,
          minimum: b.minimum,
          chairperson: b.trustees.find((t) => t.relationship.portfolio === 'Chairperson')?.person.displayName,
          coOpted: b.coOpted,
          withoutSignIn: b.trustees.filter((t) => !t.hasSignIn).length,
        };
      });
  }

  /** Owners of units in the scheme (individuals) who aren't on the board. */
  candidates(schemeId: string): BoardCandidate[] {
    const onBoard = new Set(this.db.relationshipsIn(schemeId, 'trustee').filter((r) => this.db.isCurrent(r)).map((r) => r.personId));
    const byPerson = new Map<string, BoardCandidate>();
    for (const r of this.db.relationshipsIn(schemeId, 'owner').filter((x) => this.db.isCurrent(x) && !onBoard.has(x.personId))) {
      const p = this.db.persons.get(r.personId);
      if (!p || p.kind !== 'individual') continue;
      const c = byPerson.get(p.id) ?? { personId: p.id, name: p.displayName, units: [] };
      const unit = r.unitId ? this.db.unitById.get(r.unitId) : undefined;
      if (unit) c.units.push(unit.accountNo);
      byPerson.set(p.id, c);
    }
    return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // =================================================================== Commands

  check(schemeId: string, a: BoardAction): FieldErrors | null {
    if (!this.db.schemes.has(schemeId)) return { schemeId: 'No such scheme.' };
    const current = this.db.relationshipsIn(schemeId, 'trustee').filter((r) => this.db.isCurrent(r));
    switch (a.type) {
      case 'appoint': {
        const e: FieldErrors = {};
        if (!this.candidates(schemeId).some((c) => c.personId === a.personId)) e['personId'] = 'Choose an owner in this scheme who isn’t already a trustee.';
        if (!a.portfolio) e['portfolio'] = 'Choose a portfolio.';
        if (a.portfolio === 'Chairperson' && current.some((r) => r.portfolio === 'Chairperson')) e['portfolio'] = 'The board already has a chairperson: change their portfolio first.';
        if (!a.since) e['since'] = 'When did their term start?';
        else if (a.since > todaySA()) e['since'] = 'Record the appointment once it has happened.';
        if (a.how === 'elected') {
          const r = this.governance.resolutions.find((x) => x.id === a.resolutionId);
          if (!r || r.schemeId !== schemeId || r.outcome !== 'passed') e['resolutionId'] = 'Elections are by resolution of the owners: choose the passed resolution.';
        }
        return Object.keys(e).length ? e : null;
      }
      case 'end': {
        const r = current.find((x) => x.id === a.relationshipId);
        if (!r) return { relationshipId: 'They’re not on the board.' };
        if (!a.reason.trim()) return { reason: 'Say why: resigned, sold their unit, removed at a general meeting…' };
        if (!a.on || a.on < r.since.slice(0, 10)) return { on: 'A date on or after their term started.' };
        return null;
      }
      case 'set-portfolio': {
        const r = current.find((x) => x.id === a.relationshipId);
        if (!r) return { relationshipId: 'They’re not on the board.' };
        if (a.portfolio === 'Chairperson' && current.some((x) => x.id !== r.id && x.portfolio === 'Chairperson')) return { portfolio: 'The board already has a chairperson: change their portfolio first.' };
        return null;
      }
      case 'set-minimum':
        return Number.isInteger(a.minimum) && a.minimum >= 1 && a.minimum <= 12 ? null : { minimum: 'A whole number from 1 to 12.' };
    }
  }

  act(schemeId: string, a: BoardAction, by: string): void {
    switch (a.type) {
      case 'appoint': {
        const r = a.how === 'elected' ? this.governance.resolutions.find((x) => x.id === a.resolutionId) : undefined;
        this.db.addRelationship({
          id: this.db.nextId('rel'),
          personId: a.personId,
          type: 'trustee',
          schemeId,
          portfolio: a.portfolio,
          since: new Date(`${a.since}T12:00:00`).toISOString(),
          appointment: { how: a.how, resolutionRef: r?.ref, meetingId: r?.meetingId },
        });
        this.grantAccess(schemeId, a.personId, a.portfolio, by);
        return;
      }
      case 'end': {
        // The last day in office is the day before `on` (their term ends that day).
        const until = new Date(new Date(`${a.on}T12:00:00`).getTime() - 86_400_000).toISOString();
        const r = this.db.endRelationship(a.relationshipId, until);
        if (r) {
          r.endReason = a.reason.trim();
          this.endAccess(r, by);
        }
        this.db.touch();
        return;
      }
      case 'set-portfolio': {
        const r = this.db.relationship(a.relationshipId);
        if (r) r.portfolio = a.portfolio;
        this.db.touch();
        return;
      }
      case 'set-minimum':
        this.minimums.set(schemeId, a.minimum);
        simulationStorage.save('boards', (): BoardSnapshot => ({ minimums: [...this.minimums] }));
        this.db.touch();
        return;
    }
  }

  /** D2: a trustee appointed to the board who has a Humo sign-in gets trustee access to the scheme. */
  private grantAccess(schemeId: string, personId: string, portfolio: string, by: string): void {
    const scheme = this.db.schemes.get(schemeId);
    if (!scheme) return;
    for (const i of this.access.identities().filter((x) => x.personId === personId && x.kind === 'customer' && x.status !== 'deactivated')) {
      const has = i.assignments.some((x) => x.role === 'trustee' && x.status === 'active' && x.scope.schemeIds.includes(schemeId));
      if (!has) this.access.assign(i.id, { role: 'trustee', scope: { type: 'schemes', organisationId: scheme.organisationId, schemeIds: [schemeId] }, label: `${scheme.name} · ${portfolio}` }, `${by} (board appointment)`);
    }
  }

  /** A trustee who leaves the board loses their trustee access to the scheme in Humo PM. */
  private endAccess(r: Relationship, by: string): void {
    for (const i of this.access.identities().filter((x) => x.personId === r.personId)) {
      for (const a of i.assignments.filter((x) => x.role === 'trustee' && x.status === 'active' && x.scope.type === 'schemes' && x.scope.schemeIds.includes(r.schemeId))) {
        if (a.scope.type === 'schemes' && a.scope.schemeIds.length === 1) this.access.end(i.id, a.id, by);
      }
    }
  }
}
