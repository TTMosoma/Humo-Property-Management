import { Person } from './person';
import { Scheme } from './scheme';
import { Unit } from './unit';

/**
 * Governance › Scheme rules: each scheme's conduct rules as a register — every
 * rule with its wording, when it was adopted and by which resolution, and its
 * earlier versions. Rules change only by resolution of the owners.
 *
 * The breach log records reported breaches and the warning letters sent.
 * Humo PM doesn't levy fines: an unresolved breach goes to the trustees, who
 * decide what happens next (e.g. a CSOS application).
 */

export type RuleCategory = 'pets' | 'parking' | 'noise' | 'alterations' | 'refuse' | 'common-property' | 'letting' | 'safety' | 'other';

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  pets: 'Pets',
  parking: 'Parking & vehicles',
  noise: 'Noise & nuisance',
  alterations: 'Alterations & appearance',
  refuse: 'Refuse',
  'common-property': 'Common property',
  letting: 'Letting & occupation',
  safety: 'Safety & security',
  other: 'Other',
};

export interface RuleVersion {
  text: string;
  /** yyyy-mm-dd */
  adoptedAt: string;
  /** "RES-KC-14", or "Registered rules" for those in force before Humo PM. */
  resolutionRef: string;
  resolutionId?: string;
}

export interface SchemeRule {
  id: string;
  version: number;
  schemeId: string;
  /** "4.2" */
  number: string;
  title: string;
  category: RuleCategory;
  status: 'in-force' | 'repealed';
  /** Current wording first. */
  versions: RuleVersion[];
  repealed?: { at: string; resolutionRef: string };
}

/** A scheme's rule book: when owners were last given a copy. */
export interface RuleBook {
  schemeId: string;
  /** The published copy in Documents (visible to owners and residents). */
  shared?: { at: string; by: string; documentId: string; rulesVersion: string };
  /** Rule changes since the copy was shared. */
  changedSinceShared: boolean;
}

export interface RulesView {
  scheme: Scheme;
  rules: SchemeRule[];
  book: RuleBook;
  /** Open breaches by rule id. */
  openBreaches: Record<string, number>;
}

export type RuleAction =
  | { type: 'add'; number: string; title: string; category: RuleCategory; text: string; resolutionId: string }
  | { type: 'amend'; ruleId: string; text: string; resolutionId: string }
  | { type: 'repeal'; ruleId: string; resolutionId: string }
  | { type: 'share' };

// ---------------------------------------------------------------- Breaches

export type BreachStatus = 'open' | 'warned' | 'final-warning' | 'with-trustees' | 'resolved';

export const BREACH_STATUS_LABELS: Record<BreachStatus, string> = {
  open: 'Reported',
  warned: 'Warning sent',
  'final-warning': 'Final warning sent',
  'with-trustees': 'With the trustees',
  resolved: 'Resolved',
};

export interface BreachEvent {
  at: string;
  by: string;
  kind: 'reported' | 'warning' | 'final-warning' | 'note' | 'referred' | 'resolved' | 'reopened';
  text: string;
  /** The letter in Communications › Sent. */
  sentId?: string;
}

export interface Breach {
  id: string;
  version: number;
  /** "BR-1001" */
  ref: string;
  schemeId: string;
  ruleId: string;
  unitId: string;
  /** Who the letters go to: the owner, or the tenant when they're the one in breach. */
  personId: string;
  description: string;
  /** yyyy-mm-dd: when it happened (or was first noticed). */
  occurredAt: string;
  reportedBy: string;
  status: BreachStatus;
  /** Days given to put it right in the last warning. */
  remedyBy?: string;
  events: BreachEvent[];
  assigneeId: string;
}

export interface BreachView {
  breach: Breach;
  scheme: Scheme;
  rule: SchemeRule;
  unit: Unit;
  person: Person;
  /** "owner" | "tenant" */
  personRole: string;
  assigneeName: string;
  /** Earlier breaches of the same rule at the same unit. */
  repeats: number;
}

export interface NewBreach {
  schemeId: string;
  ruleId: string;
  unitId: string;
  /** owner | tenant */
  against: 'owner' | 'tenant';
  description: string;
  occurredAt: string;
}

export type BreachAction =
  | { type: 'warn'; final: boolean; remedyDays: number; message: string; channel: 'email' | 'post' }
  | { type: 'note'; text: string }
  | { type: 'refer'; note: string }
  | { type: 'resolve'; note: string }
  | { type: 'reopen'; note: string };

/** The usual first (or final) warning letter: what rule, what happened, by when to put it right. */
export function warningLetter(name: string, number: string, title: string, what: string, final = false): string {
  return [
    `Dear ${name}`,
    '',
    `The trustees have received a report of ${what}, which is against rule ${number} (${title}) of the scheme’s conduct rules.`,
    '',
    final
      ? 'This is a final warning. If it isn’t put right by the date below, the trustees will consider further steps, which may include an application to the Community Schemes Ombud Service (CSOS).'
      : 'We ask that you put this right by the date below. If you believe the report is mistaken, or there are circumstances we should know about, please reply to this letter.',
    '',
    'Kind regards',
    'On behalf of the trustees',
  ].join('\n');
}
