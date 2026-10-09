import { UsageSnapshot } from './account-health';
import { AddOnId } from './entitlement';
import { Opportunity, OpportunityRuleId, OpportunityStrength } from './opportunity';
import { Role } from './role';

/**
 * Smart Nudges: a quiet, contextual "did you know?" — never a pop-up, never
 * twice in a row, and never again once someone says no.
 *
 * A nudge doesn't decide relevance itself: it points at an opportunity rule,
 * so the Account Manager and the product see the same evidence.
 */
export type NudgePlacement = 'tasks' | 'maintenance' | 'payables' | 'reports';

/** Frequency rules. Configurable per nudge later (Platform › Packages & features). */
export interface NudgePolicy {
  /** Never show more than once per this many days, even if ignored. */
  ignoredWaitDays: number;
  /** After "Dismiss". */
  dismissSuppressDays: number;
  /** After "Not interested": never again (null) or after N days. */
  notInterestedSuppressDays: number | null;
  /** Once the customer has the feature, the nudge retires for good. */
  retireOnConversion: true;
}

export const DEFAULT_NUDGE_POLICY: NudgePolicy = {
  ignoredWaitDays: 30,
  dismissSuppressDays: 90,
  notInterestedSuppressDays: null,
  retireOnConversion: true,
};

export interface NudgeDefinition {
  id: string;
  /** Relevance comes from the shared opportunity rule (the trigger). */
  trigger: { rule: OpportunityRuleId; minStrength: OpportunityStrength };
  addOn: AddOnId;
  placements: NudgePlacement[];
  /** Only people who could act on it (or ask their administrator). */
  audience: Role[];
  eyebrow: string;
  /** A fact about their own usage, with {placeholders} from the snapshot. */
  usageLine: string;
  suggestion: string;
  cta: string;
  /** Where "Learn more" goes. */
  destination: string;
  policy: NudgePolicy;
}

export const NUDGES: NudgeDefinition[] = [
  {
    id: 'nudge-governance',
    trigger: { rule: 'governance-addon', minStrength: 'medium' },
    addOn: 'governance',
    placements: ['tasks', 'maintenance'],
    audience: ['agency-admin', 'portfolio-manager'],
    eyebrow: 'You’re getting more out of Humo Property Management',
    usageLine: 'Your team has processed {maintenanceRequests30d} maintenance requests this month, across schemes with {trustees} trustees.',
    suggestion: 'Did you know? Governance in Humo Property Management can run trustee meetings, resolutions and their follow-up actions in the same workflow.',
    cta: 'Explore Governance',
    destination: '/settings/plan?feature=governance',
    policy: DEFAULT_NUDGE_POLICY,
  },
  {
    id: 'nudge-advanced-reporting',
    trigger: { rule: 'advanced-reporting-addon', minStrength: 'medium' },
    addOn: 'advanced-reporting',
    placements: ['payables', 'reports'],
    audience: ['agency-admin', 'finance'],
    eyebrow: 'A shortcut for your reports',
    usageLine: 'Your team exported {reportExports30d} reports this month.',
    suggestion: 'Advanced Reporting can build those reports for you, on a schedule, straight from your live data.',
    cta: 'Explore Advanced Reporting',
    destination: '/settings/plan?feature=reporting-advanced',
    policy: DEFAULT_NUDGE_POLICY,
  },
];

/** What has happened with one nudge for one person. */
export interface NudgeState {
  nudgeId: string;
  identityId: string;
  organisationId: string;
  shownAt: string[];
  dismissedAt?: string;
  snoozedUntil?: string;
  notInterestedAt?: string;
  learnMoreAt?: string;
  convertedAt?: string;
}

export type NudgeVerdict = { show: true } | { show: false; reason: string };

const DAY = 86_400_000;
const STRENGTH: Record<OpportunityStrength, number> = { low: 1, medium: 2, high: 3 };

/**
 * Should this nudge show now? Pure, so the rules are testable and the API can
 * run the same logic. `shownThisSession` keeps an already-visible nudge in
 * place rather than counting a page change as "ignored".
 */
export function evaluateNudge(
  def: NudgeDefinition,
  state: NudgeState | undefined,
  opportunities: Opportunity[],
  now: Date,
  shownThisSession = false,
): NudgeVerdict {
  const opp = opportunities.find((o) => o.rule === def.trigger.rule);
  if (state?.convertedAt) return { show: false, reason: 'Converted — retired' };
  if (!opp) return { show: false, reason: 'Trigger not met' };
  if (STRENGTH[opp.strength] < STRENGTH[def.trigger.minStrength]) return { show: false, reason: 'Not relevant enough' };
  if (state?.notInterestedAt) {
    const d = def.policy.notInterestedSuppressDays;
    if (d === null || now.getTime() - new Date(state.notInterestedAt).getTime() < d * DAY) return { show: false, reason: 'Not interested' };
  }
  if (state?.dismissedAt && now.getTime() - new Date(state.dismissedAt).getTime() < def.policy.dismissSuppressDays * DAY) {
    return { show: false, reason: `Dismissed — suppressed for ${def.policy.dismissSuppressDays} days` };
  }
  if (state?.snoozedUntil && new Date(state.snoozedUntil) > now) return { show: false, reason: 'Snoozed' };
  if (shownThisSession) return { show: true };
  const last = state?.shownAt.at(-1);
  if (last && now.getTime() - new Date(last).getTime() < def.policy.ignoredWaitDays * DAY) {
    return { show: false, reason: `Shown recently — waiting ${def.policy.ignoredWaitDays} days` };
  }
  return { show: true };
}

/** "{maintenanceRequests30d}" → 42. */
export function fillNudge(text: string, s: UsageSnapshot): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String((s as unknown as Record<string, unknown>)[k] ?? ''));
}
