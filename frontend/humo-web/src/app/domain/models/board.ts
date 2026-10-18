import { Person, Relationship } from './person';
import { Scheme } from './scheme';

/**
 * Governance › Trustee boards: who serves on each scheme's board, in which
 * portfolio, since when and how they got there. A trustee is a relationship
 * between a person and the scheme, so the board drives everything that reads
 * it — meeting quorum, who approves, the trustees' portal access.
 */

export const TRUSTEE_PORTFOLIOS = ['Chairperson', 'Treasurer', 'Secretary', 'Trustee'] as const;

/** The board's minimum size unless the scheme's rules say otherwise. */
export const DEFAULT_MIN_TRUSTEES = 3;

export interface TrusteeView {
  relationship: Relationship;
  person: Person;
  /** Their unit(s) in the scheme, e.g. "KC-042". */
  units: string[];
  /** Can sign in to Humo (approvals, meeting packs). */
  hasSignIn: boolean;
  /** Invited to Humo but hasn't accepted yet. */
  invited?: boolean;
}

export interface BoardView {
  scheme: Scheme;
  trustees: TrusteeView[];
  /** Left the board: newest first. */
  former: TrusteeView[];
  minimum: number;
  /** Co-opted trustees serve until the next AGM. */
  coOpted: number;
  /** The next AGM, if one is scheduled (elections happen there). */
  nextAgm?: { id: string; ref: string; scheduledFor: string };
}

export interface BoardSummary {
  scheme: Scheme;
  size: number;
  minimum: number;
  chairperson?: string;
  coOpted: number;
  /** Trustees without a Humo sign-in can't approve in Humo. */
  withoutSignIn: number;
}

/** An owner who could join the board. */
export interface BoardCandidate {
  personId: string;
  name: string;
  units: string[];
}

export type BoardAction =
  | { type: 'appoint'; personId: string; portfolio: string; how: 'elected' | 'co-opted'; since: string; resolutionId?: string }
  | { type: 'end'; relationshipId: string; on: string; reason: string }
  | { type: 'set-portfolio'; relationshipId: string; portfolio: string }
  | { type: 'set-minimum'; minimum: number };
